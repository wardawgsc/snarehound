const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export type LookupResponse = {
  source: string;
  profile: Record<string, unknown>;
  summary?: Record<string, unknown>;
};

export type SessionResponse = {
  user: {
    id: string;
    username: string;
  };
  entitled: boolean;
  expiresAt: number;
};

export type AuthExchangeResponse = {
  token: string;
  expiresAt: number;
  user: {
    id: string;
    username: string;
  };
  entitled: boolean;
};

export type UnknownCorrectionItem = {
  normalizedSignature: string;
  count: number;
  lastSeenAt: string;
  correctionLine: string;
};

export type UnknownCorrectionsResponse = {
  section: string;
  corrections: UnknownCorrectionItem[];
};

export type ApplyUnknownCorrectionsResponse = {
  accepted: boolean;
  filePath: string;
  requested: number;
  updated: number;
  total: number;
};

export type RecentAgentEvent = {
  receivedAt: string;
  agentId: string;
  event: Record<string, unknown>;
};

type HttpMethod = "GET" | "POST";

async function request<T>(path: string, method: HttpMethod, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`HTTP ${response.status}: ${message}`);
  }

  return payload as T;
}

export async function getDiscordAuthStart(): Promise<{ authorizeUrl: string; state: string }> {
  return request("/v1/auth/discord/start", "GET");
}

export async function exchangeDiscordAuth(code: string, state: string): Promise<AuthExchangeResponse> {
  return request("/v1/auth/discord/exchange", "POST", { code, state });
}

export async function getSession(token: string): Promise<SessionResponse> {
  return request("/v1/auth/session", "GET", undefined, token);
}

export async function lookupPlayer(handle: string): Promise<LookupResponse> {
  return request(`/v1/lookup/player/${encodeURIComponent(handle)}`, "GET");
}

export async function pushLookup(token: string, handle: string, profile: Record<string, unknown>) {
  return request<{ accepted: boolean; status: number; responseBody: string }>(
    "/v1/push/lookup",
    "POST",
    {
      handle,
      profile
    },
    token
  );
}

export async function runDevDispatchTest(handle: string, profile: Record<string, unknown>) {
  return request<{ accepted: boolean; status: number; responseBody: string }>(
    "/v1/dev/dispatch-test",
    "POST",
    {
      handle,
      profile
    }
  );
}

export async function getUnknownCorrections(limit = 25): Promise<UnknownCorrectionsResponse> {
  return request(`/v1/agent/signatures/unknown/corrections?limit=${limit}`, "GET");
}

export async function applyUnknownCorrections(
  token: string,
  entries: Array<{ normalizedSignature: string; shipName: string }>
): Promise<ApplyUnknownCorrectionsResponse> {
  return request(
    "/v1/agent/signatures/unknown/corrections/apply",
    "POST",
    { entries },
    token
  );
}

export async function getRecentAgentEvents(limit = 25): Promise<{ events: RecentAgentEvent[] }> {
  return request(`/v1/agent/events/recent?limit=${limit}`, "GET");
}

export async function clearRecentAgentEvents(token: string): Promise<{ accepted: boolean; cleared: number; remaining: number }> {
  return request("/v1/agent/events/recent/clear", "POST", {}, token);
}
