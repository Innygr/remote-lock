# Private API deployment checklist

This guide is for the early-development control plane. It does not enable Windows lock enforcement.

## 1. Prepare the private host

- Use a Windows or Linux host you administer, with Node.js 20+.
- Clone this repository on that host and enter `server/`.
- Copy `.env.example` to a local `.env` for reference, but remember the server does not automatically load that file. Configure the variables in the host's protected environment or a trusted service manager.
- Generate a unique random API password of at least 24 characters and separate random PC and Server agent tokens of at least 32 characters each. Keep these values off GitHub and out of screenshots/logs.
- Set `REMOTE_LOCK_ALLOWED_ORIGIN` to the exact browser origin serving the dashboard. For a project Pages site, the page URL may include a repository path, but the browser origin is just the scheme and host (for example, `https://YOUR-USERNAME.github.io`). Do not add a path or trailing slash.
- Keep `REMOTE_LOCK_HOST=127.0.0.1`, and choose a private writable path for `REMOTE_LOCK_STATE_FILE`. Back up that state file securely.

## 2. Start and verify locally first

From `server/`, set the environment variables in your shell/service manager, then run:

```sh
npm ci
npm test
npm start
```

In a second terminal on the same host, verify:

```sh
curl --fail http://127.0.0.1:8787/health
```

The response must include `"enforcement":"DISABLED"`. If the server refuses to start, fix its configuration rather than weakening the startup checks.

## 3. Provide private remote access

- Install and sign in to Tailscale on the API host and each authorized controller.
- Publish the loopback API only through a verified Tailscale Serve HTTPS endpoint. Follow the current Tailscale Serve documentation for your installed version; verify that the listener is private to your tailnet and does not expose a public Funnel endpoint.
- Do not configure router port forwarding, a public reverse proxy, or Tailscale Funnel for this API.
- Apply tailnet ACL/grant rules so only your intended controller devices can reach the API host/port.
- From an authorized remote device, confirm the HTTPS endpoint reaches `/health`. From a device not in the tailnet, confirm it cannot reach the endpoint.

## 4. Connect the dashboard

Open the GitHub Pages dashboard and enter the private HTTPS API URL in the API address field. The browser itself must have Tailscale access. Sign in and verify the PC/Server cards load. State buttons save desired state only; they do not lock Windows at this stage.

Do not put passwords, agent tokens, private IP addresses, or session tokens in `dashboard/config.js`, frontend source, query strings, or GitHub Actions logs. A public dashboard URL is not an authentication mechanism.

## 5. Connect agents only after pairing

- Set each agent's device ID, private HTTPS API URL, and its own unique device token through a protected local environment.
- Never copy the dashboard password/session token into an agent.
- Confirm the agent polls the intended device ID and that only that device's status changes.
- Agent reports currently describe application state only; they are not proof that Windows is securely locked.

## 6. Recovery and shutdown

Before enabling any future startup enforcement, test recovery from a second authorized controller, network loss, API restart, expired credentials, and a failed agent. Keep a local recovery path available. This prototype intentionally uses a visible, dismissible overlay and does not intercept secure Windows shortcuts or prevent process termination.

To stop a foreground API, use Ctrl+C. Do not delete the state file unless you intentionally want to reset persisted desired state and audit history.
