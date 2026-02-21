import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type AuthSession = {
  token: string;
  userId: string;
  username: string;
  accessToken: string;
  refreshToken?: string;
  discordAccessExpiresAt?: number;
  entitled: boolean;
  expiresAt: number;
};

type OAuthState = {
  state: string;
  expiresAt: number;
};

type PersistedAuthState = {
  sessions: AuthSession[];
};

const sessions = new Map<string, AuthSession>();
const oauthStates = new Map<string, OAuthState>();

let authStoreFilePath = "";

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function persistSessions(): void {
  if (!authStoreFilePath) {
    return;
  }

  ensureParentDir(authStoreFilePath);
  const payload: PersistedAuthState = {
    sessions: [...sessions.values()]
  };

  fs.writeFileSync(authStoreFilePath, JSON.stringify(payload, null, 2), "utf8");
}

export function initializeAuthStore(filePath: string): void {
  authStoreFilePath = filePath;
  ensureParentDir(authStoreFilePath);

  if (!fs.existsSync(authStoreFilePath)) {
    persistSessions();
    return;
  }

  try {
    const raw = fs.readFileSync(authStoreFilePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedAuthState;

    sessions.clear();
    for (const session of parsed.sessions ?? []) {
      if (session.expiresAt > Date.now()) {
        sessions.set(session.token, session);
      }
    }

    persistSessions();
  } catch {
    sessions.clear();
    persistSessions();
  }
}

export function createOAuthState(ttlSeconds = 600): string {
  const state = randomUUID();
  oauthStates.set(state, {
    state,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
  return state;
}

export function consumeOAuthState(state: string): boolean {
  const entry = oauthStates.get(state);
  if (!entry) {
    return false;
  }

  oauthStates.delete(state);
  return entry.expiresAt > Date.now();
}

export function createSession(input: Omit<AuthSession, "token" | "expiresAt">, ttlSeconds: number): AuthSession {
  const token = randomUUID();
  const session: AuthSession = {
    ...input,
    token,
    expiresAt: Date.now() + ttlSeconds * 1000
  };

  sessions.set(token, session);
  persistSessions();
  return session;
}

export function getSession(token: string): AuthSession | null {
  const session = sessions.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    persistSessions();
    return null;
  }

  return session;
}

export function updateSession(session: AuthSession): void {
  sessions.set(session.token, session);
  persistSessions();
}
