# Remote Lock

Personal remote-lock dashboard and Windows companion project. The dashboard can be publicly hosted, while the API is intended to stay reachable only through the owner's private network.

## Project layout

- `dashboard/` — static GitHub Pages frontend with sign-in UI.
- `server/` — authenticated API and persistent desired-state storage.
- `agent/` — planned Windows agent and per-session UI.
- `service/` — planned Windows background service.
- `installer/` — planned Windows packaging and installation scripts.

## Architecture

GitHub Pages serves only the dashboard; it cannot run the API or lock Windows devices itself. The dashboard talks to the API over HTTPS through a private Tailscale Serve endpoint. The API binds to `127.0.0.1` by default; do not port-forward it or expose it directly to the public internet. The frontend password is sent only to the configured API and is not saved by the page.

The API authenticates the owner, rejects unapproved browser origins, creates short-lived in-memory bearer sessions, and persists desired state for the fixed targets `PC` and `Server`. It deliberately reports `enforcement: DISABLED`: it saves intent only and does not lock or unlock Windows. See `server/README.md` for setup details.

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

Implemented: dashboard sign-in UI, password-authenticated API, short-lived sessions, basic login throttling, fixed PC/Server desired-state persistence, logout, strict configured CORS origin, and backend syntax-check workflow.

Not implemented: Windows agent/service, real lock enforcement, agent identity/reporting, audit trail, installer, and production security review. The Lock/Unlock buttons currently save desired state only. Do not treat them as actual device controls.
