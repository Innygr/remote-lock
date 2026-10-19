# Windows UI agent prototype

This is an early, visible WinForms prototype. It polls the private API using a device-specific token, shows a full-screen blue overlay when the desired state is `LOCKED`, hides it when `UNLOCKED`, and reports whether the overlay is shown.

**This is not a Windows secure lock screen.** It is an ordinary desktop overlay and can be dismissed or bypassed through normal Windows controls. The visible recovery button dismisses the overlay locally without changing server state. Do not use it as a security boundary or on devices without the owner's permission.

## Configure

On the target Windows PC, set these environment variables in the current PowerShell session:

```powershell
$env:REMOTE_LOCK_DEVICE = "PC" # use Server on the server device
$env:REMOTE_LOCK_AGENT_URL = "https://your-api.your-tailnet.ts.net"
$env:REMOTE_LOCK_AGENT_TOKEN = "your-unique-device-token-at-least-32-characters"
$env:REMOTE_LOCK_IMAGE = "C:\ProgramData\RemoteLock\NegInny.png"
```

Copy the image to the configured local path if you want custom artwork. The app does not require an image to run. Build and launch with the .NET 8 SDK on Windows:

```powershell
dotnet run --project .\agent\windows-ui\RemoteLock.Agent.csproj
```

The prototype runs in the foreground. It does not install a service, auto-start, disable system shortcuts, prevent task-manager access, or hide itself. Network failure preserves the currently displayed overlay; it does not infer that the device should unlock.
