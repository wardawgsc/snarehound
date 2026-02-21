import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createOAuthState, createSession, getSession, consumeOAuthState, updateSession, initializeAuthStore, type AuthSession } from "./authStore.js";
import { loadConfig, isDiscordAuthConfigured } from "./config.js";
import { checkGuildRoleEntitlement, exchangeCodeForToken, getDiscordUser, refreshAccessToken } from "./discord.js";
import { dispatchLookupPush } from "./dispatcher.js";
import { LookupError, resolveLookupProfile } from "./lookup.js";

const config = loadConfig();
const port = config.PORT;
initializeAuthStore(config.AUTH_STORE_FILE);

const server = Fastify({ logger: true });

const agentStatus = new Map<string, { lastSeenAt: number; version: string; platform: string; status?: string }>();
const recentAgentEvents: Array<{
  receivedAt: string;
  agentId: string;
  event: Record<string, unknown>;
}> = [];
const agentLibraryReports = new Map<string, Record<string, unknown>>();

function addRecentAgentEvent(entry: { receivedAt: string; agentId: string; event: Record<string, unknown> }): void {
  recentAgentEvents.push(entry);
  if (recentAgentEvents.length > config.AGENT_RECENT_EVENTS_MAX) {
    recentAgentEvents.splice(0, recentAgentEvents.length - config.AGENT_RECENT_EVENTS_MAX);
  }
}

function hydrateRecentAgentEventsFromLog(): void {
  if (!fs.existsSync(config.AGENT_EVENT_LOG_FILE)) {
    return;
  }

  const content = fs.readFileSync(config.AGENT_EVENT_LOG_FILE, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  const tailLines = lines.slice(-Math.max(config.AGENT_RECENT_EVENTS_MAX * 4, 500));

  for (const line of tailLines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type !== "agent.event") {
        continue;
      }

      const agentId = typeof parsed.agentId === "string" ? parsed.agentId : "";
      const receivedAt = typeof parsed.receivedAt === "string" ? parsed.receivedAt : new Date().toISOString();
      const event = typeof parsed.event === "object" && parsed.event !== null
        ? parsed.event as Record<string, unknown>
        : null;

      if (!agentId || !event) {
        continue;
      }

      addRecentAgentEvent({
        receivedAt,
        agentId,
        event
      });
    } catch {
      continue;
    }
  }
}

hydrateRecentAgentEventsFromLog();

function appendJsonl(filePath: string, record: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function escapeSignatureForCorrection(signature: string): string {
  return signature.replace(/\r?\n/g, "\\n");
}

function unescapeCorrectionSignature(value: string): string {
  return value.replace(/\\n/g, "\n");
}

function readCorrectionsFile(correctionsFilePath: string): Map<string, string> {
  const map = new Map<string, string>();

  if (!fs.existsSync(correctionsFilePath)) {
    return map;
  }

  const content = fs.readFileSync(correctionsFilePath, "utf8");
  let inCorrections = false;

  for (const lineRaw of content.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith(";")) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      inCorrections = line.toLowerCase() === "[corrections]";
      continue;
    }

    if (!inCorrections) {
      continue;
    }

    const idx = line.indexOf("=");
    if (idx <= 0) {
      continue;
    }

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) {
      map.set(unescapeCorrectionSignature(key), value);
    }
  }

  return map;
}

function writeCorrectionsFile(correctionsFilePath: string, corrections: Map<string, string>): void {
  const dir = path.dirname(correctionsFilePath);
  fs.mkdirSync(dir, { recursive: true });

  const lines = [
    "[Corrections]",
    "; Signature keys use literal \\n between lines (not real newlines)",
    "; Example:",
    "; <Area A>\\n<ItemNavigation B>=Anvil Arrow"
  ];

  const sorted = [...corrections.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [signature, shipName] of sorted) {
    lines.push(`${escapeSignatureForCorrection(signature)}=${shipName}`);
  }

  fs.writeFileSync(correctionsFilePath, `${lines.join("\n")}\n`, "utf8");
}

void server.register(cors, {
  origin: config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN
});

type SessionRequest = FastifyRequest & {
  authSession?: AuthSession;
};

function readBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function isAgentAuthorized(request: FastifyRequest): boolean {
  const provided = request.headers["x-agent-token"];
  if (!provided) {
    return false;
  }

  if (Array.isArray(provided)) {
    return provided.includes(config.AGENT_SHARED_TOKEN);
  }

  return provided === config.AGENT_SHARED_TOKEN;
}

async function requireEntitledSession(request: SessionRequest, reply: FastifyReply): Promise<void> {
  const token = readBearerToken(request);
  if (!token) {
    void reply.code(401).send({ error: "Missing bearer token" });
    return;
  }

  const session = getSession(token);
  if (!session) {
    void reply.code(401).send({ error: "Invalid or expired session" });
    return;
  }

  if (!isDiscordAuthConfigured(config)) {
    void reply.code(503).send({ error: "Discord auth is not configured" });
    return;
  }

  const entitled = await checkGuildRoleEntitlement(session.userId, config);
  session.entitled = entitled;
  updateSession(session);

  if (!entitled) {
    void reply.code(403).send({ error: "Not entitled for webhook push" });
    return;
  }

  request.authSession = session;
}

server.get("/health", async () => ({ status: "ok", service: "backend" }));

server.get("/v1/agent/status", async () => {
  const now = Date.now();
  return {
    agents: [...agentStatus.entries()].map(([agentId, status]) => ({
      agentId,
      ...status,
      isStale: now - status.lastSeenAt > config.AGENT_STALE_AFTER_MS,
      isOnline: now - status.lastSeenAt <= config.AGENT_STALE_AFTER_MS,
      lastSeenIso: new Date(status.lastSeenAt).toISOString(),
      libraryReport: agentLibraryReports.get(agentId) ?? null
    }))
  };
});

server.get("/v1/agent/signatures/unknown", async (request: FastifyRequest, reply: FastifyReply) => {
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(25)
  });

  const parsed = querySchema.safeParse(request.query ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid query" });
  }

  const unknown = new Map<string, { count: number; lastSeenAt: string }>();
  const hasMissEvents = recentAgentEvents.some((item) => item.event.type === "ship.resolution.miss");

  for (const item of recentAgentEvents) {
    const type = typeof item.event.type === "string" ? item.event.type : "";
    const shipName = typeof item.event.shipName === "string" ? item.event.shipName : "";
    const shouldInclude = hasMissEvents
      ? type === "ship.resolution.miss"
      : type === "ship.detected" && shipName === "UNKNOWN";
    if (!shouldInclude) {
      continue;
    }

    const normalizedSignature = typeof item.event.normalizedSignature === "string"
      ? item.event.normalizedSignature
      : "";
    if (!normalizedSignature) {
      continue;
    }

    const current = unknown.get(normalizedSignature);
    if (current) {
      current.count += 1;
      if (item.receivedAt > current.lastSeenAt) {
        current.lastSeenAt = item.receivedAt;
      }
    } else {
      unknown.set(normalizedSignature, {
        count: 1,
        lastSeenAt: item.receivedAt
      });
    }
  }

  const top = [...unknown.entries()]
    .map(([normalizedSignature, value]) => ({
      normalizedSignature,
      count: value.count,
      lastSeenAt: value.lastSeenAt
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, parsed.data.limit);

  return reply.send({ unknownSignatures: top });
});

server.get("/v1/agent/signatures/unknown/corrections", async (request: FastifyRequest, reply: FastifyReply) => {
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(25)
  });

  const parsed = querySchema.safeParse(request.query ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid query" });
  }

  const unknown = new Map<string, { count: number; lastSeenAt: string }>();
  const hasMissEvents = recentAgentEvents.some((item) => item.event.type === "ship.resolution.miss");

  for (const item of recentAgentEvents) {
    const type = typeof item.event.type === "string" ? item.event.type : "";
    const shipName = typeof item.event.shipName === "string" ? item.event.shipName : "";
    const shouldInclude = hasMissEvents
      ? type === "ship.resolution.miss"
      : type === "ship.detected" && shipName === "UNKNOWN";
    if (!shouldInclude) {
      continue;
    }

    const normalizedSignature = typeof item.event.normalizedSignature === "string"
      ? item.event.normalizedSignature
      : "";
    if (!normalizedSignature) {
      continue;
    }

    const current = unknown.get(normalizedSignature);
    if (current) {
      current.count += 1;
      if (item.receivedAt > current.lastSeenAt) {
        current.lastSeenAt = item.receivedAt;
      }
    } else {
      unknown.set(normalizedSignature, {
        count: 1,
        lastSeenAt: item.receivedAt
      });
    }
  }

  const corrections = [...unknown.entries()]
    .map(([normalizedSignature, value]) => ({
      normalizedSignature,
      count: value.count,
      lastSeenAt: value.lastSeenAt,
      correctionLine: `${escapeSignatureForCorrection(normalizedSignature)}=REPLACE_WITH_SHIP_NAME`
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, parsed.data.limit);

  return reply.send({
    section: "[Corrections]",
    corrections
  });
});

server.post(
  "/v1/agent/signatures/unknown/corrections/apply",
  {
    preHandler: requireEntitledSession
  },
  async (request: SessionRequest, reply: FastifyReply) => {
    const bodySchema = z.object({
      entries: z.array(
        z.object({
          normalizedSignature: z.string().min(1),
          shipName: z.string().min(1)
        })
      ).min(1)
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid corrections apply payload" });
    }

    const merged = readCorrectionsFile(config.AGENT_SHIP_CORRECTIONS_FILE);
    let updated = 0;
    for (const entry of parsed.data.entries) {
      const prior = merged.get(entry.normalizedSignature);
      if (prior !== entry.shipName) {
        updated += 1;
      }
      merged.set(entry.normalizedSignature, entry.shipName);
    }

    writeCorrectionsFile(config.AGENT_SHIP_CORRECTIONS_FILE, merged);

    appendJsonl(config.AGENT_EVENT_LOG_FILE, {
      type: "agent.corrections.apply",
      receivedAt: new Date().toISOString(),
      appliedBy: request.authSession?.userId ?? "unknown",
      filePath: config.AGENT_SHIP_CORRECTIONS_FILE,
      requested: parsed.data.entries.length,
      updated,
      total: merged.size
    });

    return reply.send({
      accepted: true,
      filePath: config.AGENT_SHIP_CORRECTIONS_FILE,
      requested: parsed.data.entries.length,
      updated,
      total: merged.size
    });
  }
);

server.get("/v1/agent/events/recent", async (request: FastifyRequest, reply: FastifyReply) => {
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(25)
  });

  const parsed = querySchema.safeParse(request.query ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid query" });
  }

  const limit = parsed.data.limit;
  const start = Math.max(0, recentAgentEvents.length - limit);
  return reply.send({
    events: recentAgentEvents.slice(start)
  });
});

server.post(
  "/v1/agent/events/recent/clear",
  {
    preHandler: requireEntitledSession
  },
  async (request: SessionRequest, reply: FastifyReply) => {
    const cleared = recentAgentEvents.length;
    recentAgentEvents.length = 0;

    appendJsonl(config.AGENT_EVENT_LOG_FILE, {
      type: "agent.events.recent.clear",
      receivedAt: new Date().toISOString(),
      cleared,
      clearedBy: request.authSession?.userId ?? "unknown"
    });

    return reply.send({
      accepted: true,
      cleared,
      remaining: recentAgentEvents.length
    });
  }
);

server.post("/v1/agent/register", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAgentAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized agent" });
  }

  const bodySchema = z.object({
    agentId: z.string().min(1),
    version: z.string().min(1),
    platform: z.string().min(1)
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid register payload" });
  }

  agentStatus.set(parsed.data.agentId, {
    lastSeenAt: Date.now(),
    version: parsed.data.version,
    platform: parsed.data.platform,
    status: "registered"
  });

  appendJsonl(config.AGENT_EVENT_LOG_FILE, {
    type: "agent.register",
    timestamp: new Date().toISOString(),
    ...parsed.data
  });

  return reply.send({ registered: true });
});

server.post("/v1/agent/heartbeat", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAgentAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized agent" });
  }

  const bodySchema = z.object({
    agentId: z.string().min(1),
    status: z.string().optional()
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid heartbeat payload" });
  }

  const current = agentStatus.get(parsed.data.agentId);
  agentStatus.set(parsed.data.agentId, {
    lastSeenAt: Date.now(),
    version: current?.version ?? "unknown",
    platform: current?.platform ?? "unknown",
    status: parsed.data.status ?? "heartbeat"
  });

  return reply.send({ ok: true, serverTime: Date.now() });
});

server.post("/v1/agent/events", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAgentAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized agent" });
  }

  const bodySchema = z.object({
    agentId: z.string().min(1),
    event: z.object({
      type: z.enum(["ship.detected", "ship.resolution.miss", "lookup.requested", "lookup.pushed"]),
      timestamp: z.string().min(1)
    }).and(z.record(z.unknown()))
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid event payload" });
  }

  appendJsonl(config.AGENT_EVENT_LOG_FILE, {
    type: "agent.event",
    receivedAt: new Date().toISOString(),
    agentId: parsed.data.agentId,
    event: parsed.data.event
  });

  addRecentAgentEvent({
    receivedAt: new Date().toISOString(),
    agentId: parsed.data.agentId,
    event: parsed.data.event
  });

  return reply.code(202).send({ accepted: true });
});

server.post("/v1/agent/library/report", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAgentAuthorized(request)) {
    return reply.code(401).send({ error: "Unauthorized agent" });
  }

  const bodySchema = z.object({
    agentId: z.string().min(1),
    report: z.object({
      sourcePath: z.string(),
      entryCount: z.number().int().min(0),
      mappingCount: z.number().int().min(0),
      decodeMode: z.enum(["plain", "protected"]),
      correctionCount: z.number().int().min(0),
      loadedAt: z.string().min(1),
      error: z.string().optional()
    })
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid library report payload" });
  }

  agentLibraryReports.set(parsed.data.agentId, parsed.data.report);

  appendJsonl(config.AGENT_EVENT_LOG_FILE, {
    type: "agent.library.report",
    receivedAt: new Date().toISOString(),
    ...parsed.data
  });

  return reply.send({ accepted: true });
});

if (config.ENABLE_DEV_ROUTES) {
  server.post("/v1/dev/dispatch-test", async (request: FastifyRequest, reply: FastifyReply) => {
    const bodySchema = z.object({
      handle: z.string().min(1).default("TEST_HANDLE"),
      profile: z.record(z.unknown()).default({
        source: "dev-route",
        note: "manual dispatch test"
      })
    });

    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid test payload" });
    }

    try {
      const result = await dispatchLookupPush(
        parsed.data,
        {
          userId: "dev-local",
          username: "dev-local"
        },
        config
      );

      return reply.code(result.accepted ? 202 : 502).send({
        accepted: result.accepted,
        status: result.status,
        responseBody: result.body
      });
    } catch (error) {
      return reply.code(500).send({
        error: "Dispatch test failed",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
}

server.get("/v1/auth/discord/start", async (_request: FastifyRequest, reply: FastifyReply) => {
  if (!isDiscordAuthConfigured(config)) {
    return reply.code(503).send({ error: "Discord auth env is incomplete" });
  }

  const state = createOAuthState();
  const oauthUrl = new URL("https://discord.com/oauth2/authorize");
  oauthUrl.searchParams.set("client_id", config.DISCORD_CLIENT_ID);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("redirect_uri", config.DISCORD_REDIRECT_URI);
  oauthUrl.searchParams.set("scope", "identify");
  oauthUrl.searchParams.set("state", state);
  oauthUrl.searchParams.set("prompt", "consent");

  return reply.send({
    authorizeUrl: oauthUrl.toString(),
    state
  });
});

async function completeDiscordAuth(code: string, state: string) {
  if (!consumeOAuthState(state)) {
    throw new Error("Invalid or expired OAuth state");
  }

  const token = await exchangeCodeForToken(code, config);
  const user = await getDiscordUser(token.access_token);
  const entitled = await checkGuildRoleEntitlement(user.id, config);

  const session = createSession(
    {
      userId: user.id,
      username: user.global_name ?? user.username,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      discordAccessExpiresAt: Date.now() + token.expires_in * 1000,
      entitled
    },
    config.SESSION_TTL_SECONDS
  );

  return {
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      username: session.username
    },
    entitled: session.entitled
  };
}

server.post("/v1/auth/discord/exchange", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isDiscordAuthConfigured(config)) {
    return reply.code(503).send({ error: "Discord auth env is incomplete" });
  }

  const bodySchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1)
  });

  const body = bodySchema.safeParse(request.body);
  if (!body.success) {
    return reply.code(400).send({ error: "Invalid auth exchange payload" });
  }

  try {
    const session = await completeDiscordAuth(body.data.code, body.data.state);
    return reply.send(session);
  } catch (error) {
    return reply.code(400).send({
      error: "Auth exchange failed",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

server.get("/v1/auth/discord/callback", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isDiscordAuthConfigured(config)) {
    return reply.code(503).send({ error: "Discord auth env is incomplete" });
  }

  const querySchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1)
  });

  const query = querySchema.safeParse(request.query);
  if (!query.success) {
    return reply.code(400).send({ error: "Invalid callback query" });
  }

  try {
    const session = await completeDiscordAuth(query.data.code, query.data.state);
    return reply.send(session);
  } catch (error) {
    return reply.code(400).send({
      error: "Auth callback failed",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

server.post("/v1/auth/refresh", async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isDiscordAuthConfigured(config)) {
    return reply.code(503).send({ error: "Discord auth env is incomplete" });
  }

  const token = readBearerToken(request);
  if (!token) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }

  const session = getSession(token);
  if (!session) {
    return reply.code(401).send({ error: "Invalid or expired session" });
  }

  if (!session.refreshToken) {
    return reply.code(400).send({ error: "Session has no refresh token" });
  }

  const refreshed = await refreshAccessToken(session.refreshToken, config);
  session.accessToken = refreshed.access_token;
  session.refreshToken = refreshed.refresh_token ?? session.refreshToken;
  session.discordAccessExpiresAt = Date.now() + refreshed.expires_in * 1000;
  updateSession(session);

  return reply.send({
    refreshed: true,
    expiresAt: session.expiresAt,
    discordAccessExpiresAt: session.discordAccessExpiresAt
  });
});

server.get("/v1/auth/session", async (request: FastifyRequest, reply: FastifyReply) => {
  const token = readBearerToken(request);
  if (!token) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }

  const session = getSession(token);
  if (!session) {
    return reply.code(401).send({ error: "Invalid or expired session" });
  }

  return reply.send({
    user: {
      id: session.userId,
      username: session.username
    },
    entitled: session.entitled,
    expiresAt: session.expiresAt
  });
});

server.get("/v1/lookup/player/:handle", async (request: FastifyRequest, reply: FastifyReply) => {
  const paramsSchema = z.object({ handle: z.string().min(1) });
  const parsed = paramsSchema.safeParse(request.params);

  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid handle" });
  }

  try {
    const lookup = await resolveLookupProfile(parsed.data.handle, config);
    return reply.send(lookup);
  } catch (error) {
    if (error instanceof LookupError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }

    return reply.code(500).send({
      error: "Lookup failed",
      message: error instanceof Error ? error.message : "Unknown lookup failure"
    });
  }
});

server.post(
  "/v1/push/lookup",
  {
    preHandler: requireEntitledSession
  },
  async (request: SessionRequest, reply: FastifyReply) => {
    const bodySchema = z.object({
      handle: z.string().min(1),
      profile: z.record(z.unknown())
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid lookup push payload" });
    }

    if (!request.authSession) {
      return reply.code(401).send({ error: "Missing authenticated session" });
    }

    const result = await dispatchLookupPush(
      parsed.data,
      {
        userId: request.authSession.userId,
        username: request.authSession.username
      },
      config
    );

    return reply.code(result.accepted ? 202 : 502).send({
      accepted: result.accepted,
      status: result.status,
      responseBody: result.body
    });
  }
);

const start = async () => {
  try {
    await server.listen({ host: "0.0.0.0", port });
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

void start();
