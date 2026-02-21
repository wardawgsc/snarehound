import fs from "node:fs";
import path from "node:path";
import type { BackendConfig } from "./config.js";
import { sendDiscordWebhook } from "./discord.js";

export type LookupPushPayload = {
  handle: string;
  profile: Record<string, unknown>;
};

type DispatchResult = {
  accepted: boolean;
  status: number;
  body: string;
};

function appendAuditLog(filePath: string, record: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function formatDate(isoLike: string): string {
  const input = asString(isoLike);
  if (!input) {
    return "N/A";
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function readAffiliations(profilePayload: Record<string, unknown>): string {
  const affiliations = profilePayload.affiliation;
  if (!Array.isArray(affiliations) || affiliations.length === 0) {
    return "None";
  }

  const lines: string[] = [];
  for (const item of affiliations.slice(0, 5)) {
    const obj = asObject(item);
    if (!obj) {
      continue;
    }

    const name = asString(obj.name);
    const sid = asString(obj.sid);
    if (!name) {
      continue;
    }

    if (sid) {
      lines.push(`[${name}](https://robertsspaceindustries.com/orgs/${sid}) [${sid}]`);
    } else {
      lines.push(name);
    }
  }

  if (lines.length === 0) {
    return "None";
  }

  return truncate(lines.join(" · "), 1024);
}

function buildDiscordPayload(input: LookupPushPayload): Record<string, unknown> {
  const profilePayload = input.profile;
  const profile = asObject(profilePayload.profile) ?? {};
  const organization = asObject(profilePayload.organization);

  const handle = asString(profile.handle) || input.handle;
  const display = asString(profile.display) || "N/A";
  const enlisted = formatDate(asString(profile.enlisted));

  const fluency = profile.fluency;
  const languages = Array.isArray(fluency)
    ? fluency.map((item) => asString(item)).filter(Boolean).join(", ")
    : asString(fluency);

  const locationParts = [asString(profile.country), asString(profile.region)].filter(Boolean);
  const location = locationParts.length > 0 ? locationParts.join(", ") : "N/A";
  const ueeRecord = asString(profile.id) || "N/A";

  const page = asObject(profile.page);
  const profileUrl = asString(page?.url);
  const avatarUrl = asString(profile.image);
  const badge = asString(profile.badge) || "N/A";
  const badgeImage = asString(profile.badge_image);
  const bio = truncate(asString(profile.bio), 1024);

  const orgName = asString(organization?.name) || "None";
  const orgSid = asString(organization?.sid) || "N/A";
  const orgRank = asString(organization?.rank) || "N/A";
  let orgMembers = "N/A";
  if (typeof organization?.members === "number" && Number.isFinite(organization?.members)) {
    orgMembers = String(organization.members);
  } else if (typeof organization?.members === "string" && /^\d+$/.test(organization.members)) {
    orgMembers = organization.members;
  } else if (typeof organization?.member_count === "number" && Number.isFinite(organization?.member_count)) {
    orgMembers = String(organization.member_count);
  } else if (typeof organization?.member_count === "string" && /^\d+$/.test(organization.member_count)) {
    orgMembers = organization.member_count;
  } else if (typeof organization?.total_members === "number" && Number.isFinite(organization?.total_members)) {
    orgMembers = String(organization.total_members);
  } else if (typeof organization?.total_members === "string" && /^\d+$/.test(organization.total_members)) {
    orgMembers = organization.total_members;
  } else if (typeof organization?.population === "number" && Number.isFinite(organization?.population)) {
    orgMembers = String(organization.population);
  } else if (typeof organization?.population === "string" && /^\d+$/.test(organization.population)) {
    orgMembers = organization.population;
  }
  const orgUrl = orgSid !== "N/A" ? `https://robertsspaceindustries.com/orgs/${orgSid}` : "";
  const orgDisplay = orgUrl ? `[${orgName}](${orgUrl})` : orgName;
  const orgLogoUrl = asString(organization?.image);

  const personalIntel = truncate([
    `**Handle:** ${handle}`,
    `**Display:** ${display}`,
    `**Enlisted:** ${enlisted}`,
    `**Location:** ${location}`,
    `**Languages:** ${languages || "N/A"}`,
    `**UEE Record:** ${ueeRecord}`,
    `**Dossier:** ${profileUrl ? `[Read Dossier](${profileUrl})` : "N/A"}`
  ].join("\n"), 1024);

  const orgIntel = truncate([
    `**Org:** ${orgDisplay}`,
    `**Rank:** ${orgRank}`,
    `**Tag:** ${orgSid}`,
    `**Members:** ${orgMembers}`
  ].join("\n"), 1024);

  const fields: Array<Record<string, unknown>> = [
    {
      name: "__**PERSONAL INTEL**__",
      value: personalIntel,
      inline: true
    },
    {
      name: "__**ORG INTEL**__",
      value: orgIntel,
      inline: true
    },
    {
      name: "Affiliations",
      value: readAffiliations(profilePayload),
      inline: false
    }
  ];

  if (bio) {
    fields.push({
      name: "Bio",
      value: bio,
      inline: false
    });
  }

  const embed: Record<string, unknown> = {
    title: `SnareHound Intel // ${handle}`,
    color: 13632027,
    fields,
    timestamp: new Date().toISOString(),
    footer: {
      text: orgName,
      ...(orgLogoUrl ? { icon_url: orgLogoUrl } : {})
    },
    author: {
      name: badge !== "N/A" ? badge : handle,
      ...(badgeImage ? { icon_url: badgeImage } : {})
    }
  };

  if (profileUrl) {
    embed.url = profileUrl;
  }

  if (avatarUrl) {
    embed.thumbnail = { url: avatarUrl };
  }

  return {
    username: "SnareHound Intel",
    content: "",
    embeds: [embed]
  };
}

export async function dispatchLookupPush(
  payload: LookupPushPayload,
  actor: { userId: string; username: string },
  config: BackendConfig
): Promise<DispatchResult> {
  if (!config.DISCORD_LOOKUP_WEBHOOK_URL) {
    throw new Error("DISCORD_LOOKUP_WEBHOOK_URL is not configured");
  }

  const discordPayload = buildDiscordPayload(payload);
  const result = await sendDiscordWebhook(config.DISCORD_LOOKUP_WEBHOOK_URL, discordPayload);

  appendAuditLog(config.AUDIT_LOG_FILE, {
    type: "lookup.push",
    timestamp: new Date().toISOString(),
    actor,
    handle: payload.handle,
    webhookStatus: result.status,
    accepted: result.status >= 200 && result.status < 300
  });

  return {
    accepted: result.status >= 200 && result.status < 300,
    status: result.status,
    body: result.body
  };
}
