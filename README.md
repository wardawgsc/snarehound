# SnareHound v2

Parallel rewrite workspace for SnareHound.

## Goals
- Modern web-app-first UI (browser primary)
- Contract-first backend and local agent
- Discord OAuth2 membership gating for push actions
- Clear separation of concerns and safer secret handling

## Workspace
- `apps/backend`: Fastify API + auth + dispatch policy
- `apps/frontend`: UI shell and operator workflows
- `apps/local-agent`: Windows log watcher and game bridge
- `packages/contracts`: OpenAPI and event schemas
- `packages/domain`: Detection and timeline domain logic
- `packages/shared`: Shared config/logging/error utilities

## Quick start
1. Install Node.js 20+ and pnpm.
2. From `v2/` run `pnpm install`.
3. Run backend: `pnpm dev:backend`.

### Discord auth setup (required for "Open Discord Login")
Create `infra/env/.env.local` (you can copy `infra/env/.env.local.example`) and set:
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_BOT_TOKEN`
- `DISCORD_REQUIRED_GUILD_ID`

Optional role gate:
- `DISCORD_REQUIRED_ROLE_ID`

`start-dev.ps1` and `start-backend.ps1` automatically load `infra/env/.env.local`.

## Backend auth endpoints (scaffold)
- `GET /v1/auth/discord/start`: returns Discord OAuth authorize URL + state.
- `POST /v1/auth/discord/exchange`: exchanges frontend callback `code/state` for session token.
- `GET /v1/auth/discord/callback`: exchanges code and creates local session token.
- `GET /v1/auth/session`: returns active session from bearer token.
- `POST /v1/auth/refresh`: refreshes Discord access token for an existing session.
- `POST /v1/push/lookup`: now protected by entitlement middleware (guild/role check).

## Frontend auth flow
- Frontend opens Discord login via `/v1/auth/discord/start`.
- Discord redirects to `DISCORD_REDIRECT_URI` (default `http://localhost:5173/auth/callback`).
- Callback page calls `/v1/auth/discord/exchange`, stores token locally, and auto-posts token back to opener.
- Console includes an "Unknown Signatures" panel to load and copy correction lines from backend diagnostics.
- Unknown signatures panel supports selecting rows, entering ship names, and writing selected corrections directly to backend corrections INI.

## Backend behavior (current slice)
- Auth sessions are persisted to disk (`AUTH_STORE_FILE`) for restart resilience.
- Protected lookup pushes now send to Discord webhook (`DISCORD_LOOKUP_WEBHOOK_URL`).
- Push operations append audit lines to `AUDIT_LOG_FILE`.
- Local-agent events append JSONL records to `AGENT_EVENT_LOG_FILE`.
- Backend hydrates recent in-memory agent events from `AGENT_EVENT_LOG_FILE` at startup.
- Retention cap for in-memory recent events is configurable via `AGENT_RECENT_EVENTS_MAX`.
- `GET /v1/lookup/player/:handle` now performs real lookup via StarCitizen API (`STAR_CITIZEN_API_KEY`) with optional secondary Sentry fallback.

## Agent integration endpoints
- `POST /v1/agent/register` (header: `x-agent-token`)
- `POST /v1/agent/heartbeat` (header: `x-agent-token`)
- `POST /v1/agent/events` (header: `x-agent-token`)
- `POST /v1/agent/library/report` (header: `x-agent-token`)
- `GET /v1/agent/status`
- `GET /v1/agent/events/recent?limit=25`
- `POST /v1/agent/events/recent/clear` (bearer token required; clears in-memory cache only)
- `GET /v1/agent/signatures/unknown?limit=25`
- `GET /v1/agent/signatures/unknown/corrections?limit=25`
- `POST /v1/agent/signatures/unknown/corrections/apply` (bearer token required)

`GET /v1/agent/status` now includes `isOnline`, `isStale`, and `lastSeenIso` based on `AGENT_STALE_AFTER_MS`.

## Agent log tailing (current slice)
- Local agent can tail Star Citizen log file using legacy trigger semantics.
- Set `AGENT_LOG_FILE_PATH` to your `game.log` path to enable real `ship.detected` events.
- Agent emits `ship.resolution.miss` when a signature remains unresolved (`UNKNOWN`) for direct correction triage.
- Optional tuning: `AGENT_LOG_POLL_MS`, `AGENT_SIGNATURE_FLUSH_MS`, `AGENT_TRIGGER_TEXT`, `AGENT_SHIP_KEYWORDS`.
- Optional reload interval: `AGENT_SHIP_LIBRARY_RELOAD_MS` (default 30000ms) for hot-loading shiptypes/corrections changes.
- Ship resolution now loads from `shiptypes.txt` (source of truth), including protected/encoded content support.
- Optional overrides: `AGENT_SHIP_LIBRARY_PATH`, `AGENT_SHIP_CORRECTIONS_PATH`, `AGENT_LEGACY_SCRIPT_BASE`.
- Default corrections template is at `data/ship_corrections.ini`.
- In corrections INI, signature keys are escaped with `\\n` between lines.

## What you need to provide to keep progress moving
- Discord OAuth + bot variables: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_REQUIRED_GUILD_ID` (and optional `DISCORD_REQUIRED_ROLE_ID`).
- Dispatch target: `DISCORD_LOOKUP_WEBHOOK_URL`.
- Shared secret across backend + agent: `AGENT_SHARED_TOKEN`.

## Windows PowerShell helper scripts
- Generate token: `./scripts/new-agent-token.ps1`
- Start backend (auto-sets env):
	- `./scripts/start-backend.ps1 -AgentSharedToken "<token>"`
- Start agent (same token required):
	- `./scripts/start-agent.ps1 -AgentSharedToken "<token>"`
- One-command auto launcher (opens backend + agent windows):
	- `./scripts/start-dev.ps1`
	- optional: `./scripts/start-dev.ps1 -GameLogPath "C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\game.log"`
- Stop both dev processes:
	- `./scripts/stop-dev.ps1`
- Check backend/agent live status:
	- `./scripts/status-dev.ps1`

Recommended flow:
1. Run `new-agent-token.ps1` once and copy output.
2. In terminal A run `start-backend.ps1` with that token.
3. In terminal B run `start-agent.ps1` with the same token.

Shortcut flow:
1. Run `start-dev.ps1` and it will generate/reuse a token automatically.
2. Three windows open and run backend + frontend + agent with matched env.
3. Open `http://localhost:5173` for the GUI.
4. Run `stop-dev.ps1` when done.
5. Run `status-dev.ps1` anytime to confirm health + agent/frontend connectivity.

Quick smoke check:
- Run `./scripts/smoke-dev.ps1` to verify backend health, frontend reachability, Discord auth-start readiness, and agent status endpoint.

## Local verification shortcut
- Dev-only route: `POST /v1/dev/dispatch-test` (enabled when `ENABLE_DEV_ROUTES=true`).
- This route sends a sample lookup push to `DISCORD_LOOKUP_WEBHOOK_URL` and records audit output.

## Deployment direction
- Current recommended production topology:
	- `snarebears.com` stays on Brizy (marketing/site pages)
	- Frontend app on Cloudflare Pages (`app.snarebears.com`)
	- Backend API on Render
- See `docs/V2_CONTEXT.md` and `docs/DEPLOYMENT_WEBAPP.md`.
