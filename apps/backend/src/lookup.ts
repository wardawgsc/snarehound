import type { BackendConfig } from "./config.js";

type JsonObject = Record<string, unknown>;

type LookupSource = "PRIMARY_API" | "SECONDARY_SENTRY";

type LookupResolution = {
  source: LookupSource;
  profile: JsonObject;
  summary: JsonObject;
};

type ProviderAttempt = {
  status: "found" | "not_found" | "provider_error";
  profile?: JsonObject;
  detail?: string;
};

export class LookupError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

function deepGetObject(root: JsonObject, path: string[]): JsonObject | null {
  let current: unknown = root;
  for (const segment of path) {
    const object = asObject(current);
    if (!object || !(segment in object)) {
      return null;
    }

    current = object[segment];
  }

  return asObject(current);
}

function deepGetString(root: JsonObject, paths: string[][]): string {
  for (const path of paths) {
    let current: unknown = root;
    let found = true;

    for (const segment of path) {
      const object = asObject(current);
      if (!object || !(segment in object)) {
        found = false;
        break;
      }
      current = object[segment];
    }

    if (found) {
      const value = asString(current);
      if (value) {
        return value;
      }
    }
  }

  return "";
}

function isSuccessFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function buildLookupSummary(profileData: JsonObject, requestedHandle: string, source: LookupSource): JsonObject {
  const handle = deepGetString(profileData, [["profile", "handle"], ["handle"]]) || requestedHandle;
  const display = deepGetString(profileData, [["profile", "display"], ["profile", "nickname"], ["display"], ["nickname"]]) || handle;

  const orgName = deepGetString(profileData, [["organization", "name"], ["organization", "sid"]]);
  const orgSid = deepGetString(profileData, [["organization", "sid"]]);
  const orgRank = deepGetString(profileData, [["organization", "rank"], ["organization", "rank_name"]]);

  const enlisted = deepGetString(profileData, [["profile", "enlisted"], ["enlisted"]]);
  const location = deepGetString(profileData, [["profile", "location"], ["location"]]);
  const badge = deepGetString(profileData, [["profile", "badge"], ["badge"], ["profile", "title"]]);
  const profileUrl = deepGetString(profileData, [["profile", "page", "url"], ["profile", "url"], ["url"]]);
  const avatarUrl = deepGetString(profileData, [["profile", "image"], ["profile", "avatar"], ["image"], ["avatar"]]);

  return {
    source,
    sourceLabel: source === "PRIMARY_API" ? "PRIMARY API" : "SECONDARY (SENTRY)",
    handle,
    display,
    organization: orgName || "Unknown",
    organizationSid: orgSid,
    organizationRank: orgRank,
    enlisted,
    location,
    badge,
    profileUrl,
    avatarUrl
  };
}

async function fetchPrimaryProfile(handle: string, config: BackendConfig): Promise<ProviderAttempt> {
  const apiKey = config.STAR_CITIZEN_API_KEY.trim();
  if (!apiKey) {
    return { status: "not_found", detail: "STAR_CITIZEN_API_KEY not configured" };
  }

  const encodedHandle = encodeURIComponent(handle.trim());
  let sawProviderError = false;

  for (const mode of ["live", "eager"]) {
    const url = `https://api.starcitizen-api.com/${apiKey}/v1/${mode}/user/${encodedHandle}`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });

      if (response.status >= 500) {
        sawProviderError = true;
        continue;
      }

      if (!response.ok) {
        continue;
      }

      const json = (await response.json()) as JsonObject;
      const success = isSuccessFlag(json.success);
      const data = asObject(json.data);

      if (success && data) {
        return { status: "found", profile: data };
      }

      const message = asString(json.message).toLowerCase();
      if (message.includes("can't process") || message.includes("temporarily")) {
        sawProviderError = true;
      }
    } catch {
      sawProviderError = true;
    }
  }

  if (sawProviderError) {
    return { status: "provider_error", detail: "Primary StarCitizen API unavailable" };
  }

  return { status: "not_found" };
}

async function fetchSecondarySentryProfile(handle: string, config: BackendConfig): Promise<ProviderAttempt> {
  if (!config.ENABLE_SECONDARY_LOOKUP || config.SECONDARY_LOOKUP_PROVIDER.trim().toUpperCase() !== "SENTRY") {
    return { status: "not_found" };
  }

  const base = config.SENTRY_API_BASE_URL.trim().replace(/\/+$/, "");
  if (!base) {
    return { status: "not_found" };
  }

  const encodedHandle = encodeURIComponent(handle.trim());
  const url = `${base}/citizens/${encodedHandle}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (response.status >= 500) {
      return { status: "provider_error", detail: "Secondary Sentry API unavailable" };
    }

    if (!response.ok) {
      return { status: "not_found" };
    }

    const raw = (await response.json()) as JsonObject;
    const srcProfile = asObject(raw.profile);
    if (!srcProfile) {
      return { status: "not_found" };
    }

    const resolvedHandle = asString(srcProfile.handle) || handle;
    const profile = {
      profile: {
        handle: resolvedHandle,
        display: asString(srcProfile.display_name) || resolvedHandle,
        bio: asString(srcProfile.bio),
        image: asString(srcProfile.avatar_url),
        badge: asString(srcProfile.title),
        enlisted: asString(srcProfile.enlisted),
        location: asString(srcProfile.location),
        page: {
          url: `https://robertsspaceindustries.com/citizens/${resolvedHandle}`
        }
      }
    } as JsonObject;

    const org = asObject(srcProfile.organization);
    if (org) {
      profile.organization = org;
    }

    const citizenRecord = asString(srcProfile.citizen_record);
    if (citizenRecord) {
      profile.citizen_record = citizenRecord;
    }

    return {
      status: "found",
      profile
    };
  } catch {
    return { status: "provider_error", detail: "Secondary Sentry API unavailable" };
  }
}

export async function resolveLookupProfile(handle: string, config: BackendConfig): Promise<LookupResolution> {
  const requestedHandle = handle.trim();
  if (!requestedHandle) {
    throw new LookupError("Invalid handle", 400);
  }

  const primary = await fetchPrimaryProfile(requestedHandle, config);
  if (primary.status === "found" && primary.profile) {
    return {
      source: "PRIMARY_API",
      profile: primary.profile,
      summary: buildLookupSummary(primary.profile, requestedHandle, "PRIMARY_API")
    };
  }

  const secondary = await fetchSecondarySentryProfile(requestedHandle, config);
  if (secondary.status === "found" && secondary.profile) {
    return {
      source: "SECONDARY_SENTRY",
      profile: secondary.profile,
      summary: buildLookupSummary(secondary.profile, requestedHandle, "SECONDARY_SENTRY")
    };
  }

  if (primary.status === "provider_error" || secondary.status === "provider_error") {
    throw new LookupError("Player lookup provider is temporarily unavailable", 502);
  }

  throw new LookupError(`Player not found: ${requestedHandle}`, 404);
}
