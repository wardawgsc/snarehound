import { z } from "zod";
import path from "node:path";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  DISCORD_CLIENT_ID: z.string().default(""),
  DISCORD_CLIENT_SECRET: z.string().default(""),
  DISCORD_REDIRECT_URI: z.string().default("http://localhost:5173/auth/callback"),
  DISCORD_BOT_TOKEN: z.string().default(""),
  DISCORD_REQUIRED_GUILD_ID: z.string().default(""),
  DISCORD_REQUIRED_ROLE_ID: z.string().default(""),
  STAR_CITIZEN_API_KEY: z.string().default(""),
  ENABLE_SECONDARY_LOOKUP: z.coerce.boolean().default(true),
  SECONDARY_LOOKUP_PROVIDER: z.string().default("SENTRY"),
  SENTRY_API_BASE_URL: z.string().default("https://sentry-dev.wildknightsquadron.com/api/v1"),
  SESSION_TTL_SECONDS: z.coerce.number().default(28800),
  DATA_DIR: z.string().default(path.resolve(process.cwd(), "data")),
  AUTH_STORE_FILE: z.string().default(""),
  AUDIT_LOG_FILE: z.string().default(""),
  DISCORD_LOOKUP_WEBHOOK_URL: z.string().default(""),
  ENABLE_DEV_ROUTES: z.coerce.boolean().optional(),
  AGENT_SHARED_TOKEN: z.string().default("dev-agent-token"),
  AGENT_EVENT_LOG_FILE: z.string().default(""),
  AGENT_SHIP_CORRECTIONS_FILE: z.string().default(""),
  AGENT_RECENT_EVENTS_MAX: z.coerce.number().int().min(50).max(5000).default(500),
  AGENT_STALE_AFTER_MS: z.coerce.number().int().min(5000).max(3600000).default(45000)
});

export type BackendConfig = z.infer<typeof envSchema>;

export function loadConfig(): BackendConfig {
  const parsed = envSchema.parse(process.env);
  const enableDevRoutes = parsed.ENABLE_DEV_ROUTES ?? parsed.NODE_ENV !== "production";

  return {
    ...parsed,
    ENABLE_DEV_ROUTES: enableDevRoutes,
    AUTH_STORE_FILE: parsed.AUTH_STORE_FILE || path.join(parsed.DATA_DIR, "auth-sessions.json"),
    AUDIT_LOG_FILE: parsed.AUDIT_LOG_FILE || path.join(parsed.DATA_DIR, "audit-log.jsonl"),
    AGENT_EVENT_LOG_FILE: parsed.AGENT_EVENT_LOG_FILE || path.join(parsed.DATA_DIR, "agent-events.jsonl"),
    AGENT_SHIP_CORRECTIONS_FILE: parsed.AGENT_SHIP_CORRECTIONS_FILE || path.join(parsed.DATA_DIR, "ship_corrections.ini")
  };
}

export function isDiscordAuthConfigured(config: BackendConfig): boolean {
  return (
    config.DISCORD_CLIENT_ID.length > 0 &&
    config.DISCORD_CLIENT_SECRET.length > 0 &&
    config.DISCORD_BOT_TOKEN.length > 0 &&
    config.DISCORD_REQUIRED_GUILD_ID.length > 0
  );
}
