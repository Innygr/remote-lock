# Remote Lock agent poller (prototype)

This is a foreground connectivity prototype, not a Windows service and not a lock-screen implementation. It authenticates as exactly one device using a unique per-device token, polls that device's desired state, and sends a heartbeat report. It deliberately reports `UNKNOWN` and never locks, unlocks, hides itself, changes startup settings, or blocks user input.

## Requirements

- Node.js 20 or newer.
- The private API must be reachable through the configured HTTPS Tailscale Serve endpoint.
- A separate random 32+ character token for this device, configured on the API host and target device. Do not reuse the dashboard password.

## Run in PowerShell

Set the values in the current PowerShell window (replace the placeholders; do not commit them):

```powershell
$env:REMOTE_LOCK_DEVICE = "PC" # or Server
$env:REMOTE_LOCK_AGENT_URL = "https://your-api.your-tailnet.ts.net"
$env:REMOTE_LOCK_AGENT_TOKEN = "your-unique-device-token-at-least-32-characters"
node .\agent\poller.mjs
```

The process stays in the foreground and prints when the desired state changes. Press Ctrl+C to stop it. It does not install itself or persist across reboot.

## Before enforcement

The next stage is a visible per-user session UI with an accessible recovery path and explicit user authorization. Only after that is tested should the agent report actual UI state. This poller is not a security boundary and must not be treated as proof that Windows is locked.
