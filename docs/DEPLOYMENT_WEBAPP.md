# Web App Deployment Runbook

This runbook implements the chosen topology:
- snarebears.com on Brizy (marketing + website pages)
- app frontend on Cloudflare Pages at app.snarebears.com
- backend API on Render at api.snarebears.com

## 1) DNS and subdomains
Create these DNS targets in your DNS provider:
- app.snarebears.com -> Cloudflare Pages project
- api.snarebears.com -> Render backend service

If your DNS is already managed in Cloudflare, both are straightforward CNAME bindings.

## 2) Backend on Render (Fastify)
### Service type
- Create a Render Web Service from the v2 repository.
- Option A (recommended): use Blueprint deploy via `render.yaml` in repo root for one-click setup.
- Option B: manual service creation using commands below.

### Build and start
- Build command: npm ci ; npm run build --workspace @snarehound/backend
- Start command: npm run start --workspace @snarehound/backend
- Blueprint file includes equivalent commands using `-w @snarehound/backend`.

### Required environment variables
Set these in Render:
- NODE_ENV=production
- PORT=10000 (or Render-provided port handling)
- CORS_ORIGIN=https://app.snarebears.com
- DISCORD_CLIENT_ID=<value>
- DISCORD_CLIENT_SECRET=<value>
- DISCORD_REDIRECT_URI=https://app.snarebears.com/auth/callback
- DISCORD_BOT_TOKEN=<value>
- DISCORD_REQUIRED_GUILD_ID=<value>
- DISCORD_REQUIRED_ROLE_ID=<optional>
- STAR_CITIZEN_API_KEY=<value>
- DISCORD_LOOKUP_WEBHOOK_URL=<value>
- AGENT_SHARED_TOKEN=<strong random token>
- SESSION_TTL_SECONDS=28800
- ENABLE_DEV_ROUTES=false

Optional:
- ENABLE_SECONDARY_LOOKUP=true
- SECONDARY_LOOKUP_PROVIDER=SENTRY
- SENTRY_API_BASE_URL=https://sentry-dev.wildknightsquadron.com/api/v1

### Important note on storage
Current backend defaults to local file-based persistence in DATA_DIR.
On free/ephemeral hosts, local disk may reset on redeploy/restart.
For MVP this can be acceptable, but audit/session/event files should be considered non-durable unless persistent disk is configured.

## 3) Frontend on Cloudflare Pages
### Project
- Create a Cloudflare Pages project from the same repository.
- Root directory: v2/apps/frontend

### Build settings
- Build command: npm ci ; npm run build
- Output directory: dist

### Frontend env variable
Set:
- VITE_API_BASE_URL=https://api.snarebears.com

### Route behavior
Cloudflare Pages supports SPA behavior with redirect rules.
If needed, configure fallback so unknown routes resolve to index.html.
- Repo already includes SPA fallback file: `apps/frontend/public/_redirects`.

## 4) Discord OAuth production update
In Discord Developer Portal:
- Add redirect URI: https://app.snarebears.com/auth/callback
- Keep localhost callback for dev if needed.

## 5) Brizy linking
On snarebears.com (Brizy):
- Add prominent CTA/button: Open App
- Link target: https://app.snarebears.com

Recommended:
- Keep marketing/docs pages in Brizy.
- Keep operator app isolated on app.snarebears.com.

## 6) Smoke test checklist
1. Open https://app.snarebears.com
2. Verify frontend can call backend (no CORS errors)
3. Click Open Discord Login and complete OAuth
4. Confirm session check succeeds
5. Run player lookup
6. Trigger protected push and verify webhook delivery
7. Confirm agent status endpoint works from hosted backend

## 7) Rollback strategy
- Backend: use Render deploy history rollback
- Frontend: use Cloudflare Pages previous deployment restore
- Keep env values versioned outside repo (password manager)

## 8) Recommended immediate hardening
- Set ENABLE_DEV_ROUTES=false in production
- Rotate all dev-time secrets before go-live
- Add simple health monitor for api.snarebears.com
- Add basic rate limiting for auth and push endpoints

## 9) Repo deployment assets added
- Render Blueprint: `render.yaml`
- Cloudflare SPA fallback: `apps/frontend/public/_redirects`
