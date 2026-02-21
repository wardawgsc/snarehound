# SnareHound v2 Context

## Purpose
This document is the working context for SnareHound v2 implementation and deployment decisions.

## Current Product Direction
- Primary direction is now **web app first**.
- We are prioritizing browser-based UX and hosted backend/API over desktop shell packaging.
- Existing local workflow remains valuable for development and operator testing.

## Current Architecture
- `apps/frontend`: React + Vite operator UI (HUD, lookup, push controls, auth flow)
- `apps/backend`: Fastify API (Discord OAuth/session, entitlement checks, lookup, push, agent endpoints)
- `apps/local-agent`: Windows log watcher + event forwarder
- `packages/domain` / `packages/shared`: shared logic/utilities
- `infra/env/.env.local`: runtime env config for local dev

## Core Functional Status (as of Feb 2026)
- Discord OAuth login flow works end-to-end.
- Entitlement protection (guild/role gate) is enforced on protected push routes.
- Player lookup is provider-backed (primary + fallback behavior in backend).
- Protected dispatch/push path is integrated.
- Local-agent registration/heartbeat/events are wired.
- Unknown ship signature diagnostics and correction apply flow are implemented.
- Frontend HUD has v1-inspired layout, hangar cycle timer, and control panel actions.

## UX/Behavior Constraints
- Maintain v1 visual language (colors, information hierarchy, tactical HUD feel).
- Keep existing operator controls functional while improving visual parity.
- Preserve quick workflows: lookup, push, recent history, correction operations.
- Lookup should work with both button click and Enter key submission.

## Web App Route (Decision)
We are explicitly shifting v2 toward a hosted web app model:
1. Host frontend as a static app (CDN/static hosting).
2. Host backend API as a lightweight Node/Fastify service.
3. Keep local-agent as an optional companion process for local signal ingestion where needed.
4. Keep Discord entitlement checks server-side only.

## Initial Deployment Shape
- Frontend: static host with HTTPS.
- Backend: single service, low-cost/free tier, environment-variable managed secrets.
- Data/log persistence: lightweight file/log storage initially, with optional managed DB later.
- Expected load: <20 concurrent users at launch.

## Free Backend Hosting Recommendations (<20 concurrent users)

### 1) Render (Free Web Service)
- Good DX for Node/Fastify, simple GitHub deploys.
- Supports env vars, HTTPS, logs, and easy rollbacks.
- Tradeoff: cold starts/sleep behavior on free tier.

### 2) Railway (Trial/low-cost friendly; occasional free credits/promos)
- Very easy setup, strong developer experience, good for quick iteration.
- Great for early prototypes and low traffic.
- Tradeoff: free availability can vary over time by plan/credits.

### 3) Fly.io (can be near-free at very small usage)
- Good control, global placement options, supports Dockerized backend.
- Works well for always-on lightweight services if resource use is low.
- Tradeoff: slightly more ops setup than Render.

### 4) Cloudflare Workers (free tier, serverless)
- Excellent free tier and global edge runtime.
- Very low latency and generous request capacity.
- Tradeoff: backend may need adaptation from Node/Fastify patterns to Workers-compatible runtime.

### 5) Deta Space / Similar micro-hosts (where available)
- Fast for simple API prototypes.
- Tradeoff: ecosystem/platform stability and feature depth vary.

## Recommended Starting Choice
For fastest path with minimal refactor: **Render** for backend + static frontend hosting (Render Static Site, Netlify, or Cloudflare Pages).
- Why: lowest migration friction from current Fastify Node backend.
- Works well for initial <20 concurrent users.

## Selected Topology (Confirmed)
- Keep `snarebears.com` on Brizy for website/marketing pages.
- Deploy app frontend to Cloudflare Pages at `app.snarebears.com`.
- Deploy backend API to Render at `api.snarebears.com`.
- Link users from Brizy site to the app subdomain.
- Detailed execution steps live in `docs/DEPLOYMENT_WEBAPP.md`.

## Security & Operations Notes
- Keep Discord secrets and shared tokens only in host environment variables.
- Do not commit `.env.local` or credential-bearing config.
- Enable basic request logging and health checks from day 1.
- Add simple rate limiting on auth and push endpoints before public rollout.

## Near-Term Execution Checklist
1. Finalize frontend production environment URL wiring.
2. Deploy backend to selected host (Render recommended).
3. Deploy frontend static build to public HTTPS URL.
4. Update Discord OAuth redirect URIs to production domain.
5. Smoke test auth, entitlement, lookup, and protected push in hosted environment.
6. Add uptime and error monitoring (basic free-tier tooling first).
