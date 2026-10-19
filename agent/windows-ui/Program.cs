using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace RemoteLock.Agent;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new AgentForm());
    }
}

internal sealed class AgentForm : Form
{
    private readonly string _device = Environment.GetEnvironmentVariable("REMOTE_LOCK_DEVICE") ?? "";
    private readonly string _apiBase = (Environment.GetEnvironmentVariable("REMOTE_LOCK_AGENT_URL") ?? "").TrimEnd('/');
    private readonly string _token = Environment.GetEnvironmentVariable("REMOTE_LOCK_AGENT_TOKEN") ?? "";
    private readonly string _imagePath = Environment.GetEnvironmentVariable("REMOTE_LOCK_IMAGE")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "RemoteLock", "NegInny.png");
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(8) };
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 15000 };
    private readonly Label _status = new() { AutoSize = true, Text = "Not connected" };
    private readonly Label _desired = new() { AutoSize = true, Text = "Desired state: unknown" };
    private readonly Button _pollNow = new() { Text = "Check now", AutoSize = true };
    private readonly Button _showOverlay = new() { Text = "Show preview", AutoSize = true };
    private readonly LockOverlay _overlay;
    private bool _polling;
    private string _lastDesired = "UNLOCKED";

    public AgentForm()
    {
        Text = "Remote Lock Agent (prototype)";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(480, 230);
        Size = new Size(600, 290);
        BackColor = Color.FromArgb(16, 24, 39);
        ForeColor = Color.FromArgb(235, 242, 252);
        Font = new Font("Segoe UI", 10);
        _overlay = new LockOverlay(_imagePath, OnRecoveryClose);

        var title = new Label
        {
            Text = "Remote Lock Agent",
            Font = new Font("Segoe UI", 18, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(24, 20)
        };
        var description = new Label
        {
            Text = "Visible foreground prototype · overlay only, not Windows secure lock",
            AutoSize = true,
            ForeColor = Color.FromArgb(164, 181, 205),
            Location = new Point(26, 62)
        };
        _status.Location = new Point(26, 105);
        _desired.Location = new Point(26, 135);
        _pollNow.Location = new Point(26, 175);
        _showOverlay.Location = new Point(140, 175);
        Controls.AddRange([title, description, _status, _desired, _pollNow, _showOverlay]);

        _pollNow.Click += async (_, _) => await PollAsync();
        _showOverlay.Click += (_, _) => ShowOverlay();
        _timer.Tick += async (_, _) => await PollAsync();
        Shown += async (_, _) =>
        {
            if (!ValidateConfiguration()) return;
            await PollAsync();
            _timer.Start();
        };
        FormClosed += (_, _) =>
        {
            _timer.Stop();
            _http.Dispose();
            if (!_overlay.IsDisposed) _overlay.Close();
        };
    }

    private bool ValidateConfiguration()
    {
        if (!new[] { "PC", "Server" }.Contains(_device) ||
            !Uri.TryCreate(_apiBase, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || _token.Length < 32 || _token.Contains("replace-with-", StringComparison.Ordinal))
        {
            _status.Text = "Configuration missing or invalid. Set the documented REMOTE_LOCK_* variables.";
            _pollNow.Enabled = false;
            return false;
        }

        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        return true;
    }

    private async Task PollAsync()
    {
        if (_polling || !IsHandleCreated || IsDisposed) return;
        _polling = true;
        _pollNow.Enabled = false;
        try
        {
            var desiredResponse = await _http.GetAsync($"{_apiBase}/agent/{_device}/desired");
            var desiredJson = await desiredResponse.Content.ReadAsStringAsync();
            desiredResponse.EnsureSuccessStatusCode();
            using var desiredDoc = JsonDocument.Parse(desiredJson);
            var desired = desiredDoc.RootElement.GetProperty("desiredState").GetString() ?? "UNKNOWN";
            if (desired is not ("LOCKED" or "UNLOCKED"))
                throw new InvalidOperationException("The API returned an invalid desired state.");

            _lastDesired = desired;
            _desired.Text = "Desired state: " + desired;
            if (desired == "LOCKED") ShowOverlay();
            else HideOverlay();

            var overlayShown = _overlay.Visible;
            var report = JsonSerializer.Serialize(new { reportedState = overlayShown ? "LOCKED" : "UNLOCKED" });
            using var body = new StringContent(report, Encoding.UTF8, "application/json");
            var reportResponse = await _http.PostAsync($"{_apiBase}/agent/{_device}/report", body);
            reportResponse.EnsureSuccessStatusCode();
            _status.Text = $"Connected · {DateTime.Now:T} · overlay { (overlayShown ? "shown" : "hidden") }";
        }
        catch (Exception ex)
        {
            _status.Text = "Connection error: " + ex.Message;
            // Keep the current visible state while disconnected; never infer unlock from a network failure.
        }
        finally
        {
            _polling = false;
            _pollNow.Enabled = true;
        }
    }

    private void ShowOverlay()
    {
        if (_overlay.IsDisposed) return;
        if (!_overlay.Visible)
        {
            _overlay.Show();
            _overlay.BringToFront();
        }
        _overlay.TopMost = true;
        _overlay.Activate();
    }

    private void HideOverlay()
    {
        if (_overlay.Visible) _overlay.Hide();
    }

    private void OnRecoveryClose()
    {
        // Recovery close only dismisses this prototype overlay. It does not change server desired state.
        _overlay.Hide();
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
        _status.Text = "Overlay dismissed locally for recovery; server desired state remains " + _lastDesired + ".";
    }
}

internal sealed class LockOverlay : Form
{
    private readonly Action _recoveryClose;

    public LockOverlay(string imagePath, Action recoveryClose)
    {
        _recoveryClose = recoveryClose;
        FormBorderStyle = FormBorderStyle.None;
        WindowState = FormWindowState.Maximized;
        TopMost = true;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(29, 83, 145);
        ForeColor = Color.White;
        KeyPreview = true;

        var content = new Panel { Dock = DockStyle.Fill, BackColor = Color.Transparent };
        content.Paint += (_, e) =>
        {
            using var path = new System.Drawing.Drawing2D.GraphicsPath();
            path.AddEllipse(-Width * 0.2f, -Height * 0.25f, Width * 1.4f, Height * 1.5f);
            using var brush = new System.Drawing.Drawing2D.PathGradientBrush(path)
            {
                CenterColor = Color.FromArgb(35, 103, 176),
                SurroundColors = [Color.FromArgb(7, 17, 34)]
            };
            e.Graphics.FillRectangle(brush, content.ClientRectangle);
        };

        var message = new Label
        {
            Text = "Nuh uh bruh",
            ForeColor = Color.White,
            BackColor = Color.Transparent,
            Font = new Font("Segoe UI", 32, FontStyle.Bold),
            AutoSize = true,
            TextAlign = ContentAlignment.MiddleCenter,
            Anchor = AnchorStyles.None
        };
        var image = new PictureBox
        {
            Size = new Size(240, 240),
            SizeMode = PictureBoxSizeMode.Zoom,
            BackColor = Color.Transparent,
            Anchor = AnchorStyles.None
        };
        try
        {
            if (File.Exists(imagePath))
                using (var loaded = Image.FromFile(imagePath))
                    image.Image = new Bitmap(loaded);
        }
        catch
        {
            // Missing or invalid art should not crash the agent; the text remains visible.
        }

        var recovery = new Button
        {
            Text = "Dismiss overlay for recovery",
            AutoSize = true,
            Anchor = AnchorStyles.None,
            BackColor = Color.FromArgb(230, 240, 252),
            ForeColor = Color.FromArgb(10, 24, 42),
            FlatStyle = FlatStyle.Flat
        };
        recovery.Click += (_, _) => _recoveryClose();

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Transparent,
            ColumnCount = 1,
            RowCount = 4,
            Padding = new Padding(24)
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 20));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 42));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 23));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 15));
        image.Anchor = AnchorStyles.None;
        message.Anchor = AnchorStyles.None;
        recovery.Anchor = AnchorStyles.None;
        layout.Controls.Add(new Panel { Dock = DockStyle.Fill, BackColor = Color.Transparent }, 0, 0);
        layout.Controls.Add(image, 0, 1);
        layout.Controls.Add(message, 0, 2);
        layout.Controls.Add(recovery, 0, 3);
        content.Controls.Add(layout);
        Controls.Add(content);

        FormClosed += (_, _) =>
        {
            image.Image?.Dispose();
        };
    }
}
