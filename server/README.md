# Remote Lock private API (early development)

This service provides an authenticated control-plane API. It records requested state for the fixed targets `PC` and `Server`; it does **not** enforce Windows locking yet. Responses explicitly report that enforcement is disabled.

## Requirements

- Node.js 20 or newer.
- A long unique password (at least 24 characters) kept only on the private server.
- A private Tailscale path for the API. Do not forward port 8787 from your router or expose it directly to the public internet.
- The exact HTTPS origin of the GitHub Pages dashboard in `REMOTE_LOCK_ALLOWED_ORIGIN`.

## Run locally

1. Copy `.env.example` to `.env` and replace the placeholder password with a long random secret. Keep `.env` out of Git.
2. Set `REMOTE_LOCK_ALLOWED_ORIGIN` to the exact dashboard origin, such as `https://YOUR-USERNAME.github.io` (use the actual published site origin).
3. Set the environment variables in the shell or through a trusted local environment-file loader. The server intentionally does not load `.env` automatically.
4. Run `npm start` from this directory.
5. Keep the API bound to `127.0.0.1`; publish it only through a verified Tailscale Serve configuration. The browser must have Tailscale access to reach the API.

## API

- `GET /health` — health check; reports enforcement disabled.
- `POST /api/login` — JSON `{ "username": "Innygr", "password": "..." }`; returns a short-lived bearer token.
- `GET /api/session` — current authenticated session.
- `GET /api/devices` — persisted desired state and observed-state placeholders, including recent audit history.
- `GET /api/audit` — last 100 state-change audit entries (authenticated).
- `POST /api/devices/PC/state` or `/api/devices/Server/state` — JSON `{ "desiredState": "LOCKED" }` or `UNLOCKED`; saves intent only.
- `POST /api/logout` — invalidates the bearer token.
- `GET /agent/PC/desired` and `GET /agent/Server/desired` — device-token-authenticated desired-state polling.
- `POST /agent/PC/report` and `POST /agent/Server/report` — device-token-authenticated reported-state updates.

Each agent token is configured independently with `REMOTE_LOCK_AGENT_PC_TOKEN` and `REMOTE_LOCK_AGENT_SERVER_TOKEN`. Use different random secrets of at least 32 characters; never reuse the dashboard password or session token. An unconfigured agent endpoint returns `503`. Agent reports update connection metadata but do not perform enforcement.

Tokens are held in server memory and expire after eight hours. The dashboard should keep its token in memory only, never localStorage or a URL. The server rejects browser origins other than the configured exact origin and uses timing-safe credential comparison plus basic login throttling.

## Before real enforcement

- Add an agent-specific authenticated protocol; do not let a dashboard token authenticate a Windows agent.
- Add per-device identity, replay protection, audit logging, and robust rate limiting.
- Verify Tailscale Serve and ACL policy from an outside device before use.
- Build and test a reliable recovery/unlock path before any startup enforcement.
- Never claim a target is locked based solely on desired state; require an authenticated agent report.
