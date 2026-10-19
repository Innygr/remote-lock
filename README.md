# Remote Lock

Personal remote-lock dashboard and Windows companion project. The dashboard can be publicly hosted, while the API is intended to stay reachable only through the owner's private network.

## Project layout

- `dashboard/` — static GitHub Pages frontend with sign-in UI and recent activity.
- `server/` — authenticated API, persistent desired-state storage, audit trail, and per-device agent endpoints.
- `agent/` — transparent foreground polling prototype and visible WinForms overlay UI; no Windows secure lock enforcement.
- `service/` — planned Windows background service.
- `installer/` — planned Windows packaging and installation scripts.

## Architecture

GitHub Pages serves only the dashboard; it cannot run the API or lock Windows devices itself. The dashboard talks to the API over HTTPS through a private Tailscale Serve endpoint. The API binds to `127.0.0.1` by default; do not port-forward it or expose it directly to the public internet.

The API authenticates the owner, rejects unapproved browser origins, creates short-lived in-memory dashboard sessions, and persists desired state for the fixed targets `PC` and `Server`. It records a bounded audit history for state requests. Agents use separate per-device tokens rather than dashboard credentials. Device online indicators expire if no heartbeat has been seen for 90 seconds.

The API and poller deliberately report `enforcement: DISABLED` or `reportedState: UNKNOWN`: they save intent and demonstrate authenticated communication but do not lock or unlock Windows. See `server/README.md` and `agent/README.md` for setup details.

## Security requirements

- Do not commit credentials, PINs, tokens, private keys, runtime state, or device secrets.
- Never place backend credentials in frontend JavaScript.
- Do not expose the lock API publicly or rely on a secret URL.
- Configure the exact published dashboard origin in the API environment.
- Use separate, device-bound authentication for Windows agents; never reuse the dashboard bearer token for agents.
- Provide a tested, authenticated recovery/unlock path before enabling startup enforcement.
- Use a service for background connectivity and a separate per-session UI where needed; Windows services cannot normally interact directly with a user's desktop.
- Treat GitHub Pages as a static frontend only.
- Use this only on devices you own or are explicitly authorized to administer.

## Current status

Implemented: dashboard sign-in UI and activity panel, password-authenticated API, short-lived sessions, basic login throttling, fixed PC/Server desired-state persistence, bounded audit history, per-device authenticated desired-state/report endpoints, a foreground polling prototype, and automated API/JavaScript checks.

Not implemented: Windows secure lock enforcement, production agent identity/replay protection, comprehensive audit retention, installer, and production security review. The WinForms overlay is a visible, bypassable desktop window—not the Windows sign-in screen. The Lock/Unlock buttons currently save desired state only. Agent reports are not proof of a locked desktop.
