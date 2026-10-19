# Remote Lock

Private project for a personal remote-lock dashboard and Windows companion software.

## Project layout

- `dashboard/` — static GitHub Pages frontend.
- `agent/` — planned Windows agent and session UI.
- `service/` — planned Windows background service.
- `server/` — planned authenticated API and durable desired-state storage.
- `installer/` — planned Windows packaging and installation scripts.

## Architecture

GitHub Pages serves only the dashboard. It does not run the API or lock Windows devices itself. The API is intended to run on the owner's local server and be reachable only through a private network such as Tailscale. Windows targets need locally installed software.

The backend must store desired state separately from observed state so an offline device can reconcile after reconnecting. Lock and unlock commands must require authentication and explicit device authorization.

## Security requirements

- Do not commit credentials, PINs, tokens, private keys, or device secrets.
- Never place backend credentials in frontend JavaScript.
- Do not expose the lock API publicly or rely on a secret URL.
- Provide a tested, authenticated recovery/unlock path before enabling startup enforcement.
- Use a service for background connectivity and a separate per-session UI where needed; Windows services cannot normally interact directly with a user's desktop.
- Treat GitHub Pages as a static frontend only.
- Use this only on devices you own or are explicitly authorized to administer.

## Status

Initial repository scaffold. No working lock enforcement or production-ready backend has been implemented yet.