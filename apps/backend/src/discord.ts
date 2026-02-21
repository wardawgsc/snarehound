import { z } from "zod";
import type { BackendConfig } from "./config.js";

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

type DiscordUser = {
  id: string;
  username: string;
  discriminator: string;
  global_name: string | null;
};

type GuildMember = {
  user: {
    id: string;
  };
  roles: string[];
};

const tokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string()
});

export async function exchangeCodeForToken(code: string, config: BackendConfig): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    client_secret: config.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.DISCORD_REDIRECT_URI
  });

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord token exchange failed: ${response.status} ${text}`);
  }

  const json = await response.json();
  return tokenSchema.parse(json);
}

export async function refreshAccessToken(refreshToken: string, config: BackendConfig): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    client_secret: config.DISCORD_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord token refresh failed: ${response.status} ${text}`);
  }

  const json = await response.json();
  return tokenSchema.parse(json);
}

export async function getDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord user fetch failed: ${response.status} ${text}`);
  }

  return (await response.json()) as DiscordUser;
}

export async function checkGuildRoleEntitlement(userId: string, config: BackendConfig): Promise<boolean> {
  const response = await fetch(
    `https://discord.com/api/guilds/${config.DISCORD_REQUIRED_GUILD_ID}/members/${userId}`,
    {
      headers: {
        Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`
      }
    }
  );

  if (response.status === 404 || response.status === 403) {
    return false;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord guild member fetch failed: ${response.status} ${text}`);
  }

  const member = (await response.json()) as GuildMember;

  if (!config.DISCORD_REQUIRED_ROLE_ID) {
    return true;
  }

  return member.roles.includes(config.DISCORD_REQUIRED_ROLE_ID);
}

export async function sendDiscordWebhook(webhookUrl: string, payload: unknown): Promise<{ status: number; body: string }> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.text();
  return {
    status: response.status,
    body
  };
}
