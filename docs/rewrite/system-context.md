# System Context

## Components
- Frontend (Tauri-first): operator UI.
- Backend (Fastify): auth, policy, proxy, dispatch.
- Local Agent (Windows): log reading and game command bridge.

## Data flow
1. Local agent reads runtime signals and emits events.
2. Frontend consumes backend APIs for lookup and push actions.
3. Backend validates Discord membership/roles before accepting push requests.
4. Backend sends Discord webhooks and records audit events.
