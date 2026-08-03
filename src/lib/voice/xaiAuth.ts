import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { dataPath } from "@/lib/paths";

export const XAI_OAUTH_ISSUER = "https://auth.x.ai";
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const XAI_DEVICE_CODE_URL = `${XAI_OAUTH_ISSUER}/oauth2/device/code`;
export const XAI_TOKEN_URL = `${XAI_OAUTH_ISSUER}/oauth2/token`;
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const sessionPath = dataPath("voice", "xai-oauth.json");

export type XaiSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  source: "device_code" | "cli_import";
  obtainedAt: number;
};

export function jwtExpiryMs(token: string): number {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function normalizeXaiSession(raw: unknown, source: XaiSession["source"] = "device_code"): XaiSession | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const accessToken = String(value.accessToken ?? value.access_token ?? value.key ?? "").trim();
  const refreshToken = String(value.refreshToken ?? value.refresh_token ?? "").trim();
  if (!accessToken && !refreshToken) return null;

  let expiresAt = 0;
  if (typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)) expiresAt = value.expiresAt;
  else if (typeof value.expires_at === "string" && value.expires_at) {
    const parsed = Date.parse(value.expires_at);
    if (Number.isFinite(parsed)) expiresAt = parsed;
  } else if (typeof value.expires_in === "number" && Number.isFinite(value.expires_in)) {
    expiresAt = Date.now() + Math.max(0, value.expires_in) * 1000;
  } else if (accessToken) {
    expiresAt = jwtExpiryMs(accessToken);
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    email: typeof value.email === "string" ? value.email.trim() : "",
    source: value.source === "cli_import" || value.source === "device_code" ? value.source : source,
    obtainedAt: typeof value.obtainedAt === "number" ? value.obtainedAt : Date.now()
  };
}

export async function readXaiSession(): Promise<XaiSession | null> {
  try {
    return normalizeXaiSession(JSON.parse(await readFile(sessionPath, "utf8")), "device_code");
  } catch {
    return null;
  }
}

export async function writeXaiSession(session: XaiSession): Promise<XaiSession> {
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const tmp = `${sessionPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(session, null, 2), "utf8");
  try {
    await rename(tmp, sessionPath);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  return session;
}

export async function clearXaiSession(): Promise<void> {
  await rm(sessionPath, { force: true });
}

/**
 * The Grok CLI keeps its OAuth session in ~/.grok/auth.json, keyed by
 * "<issuer>::<client id>". Importing it is the shortest path to a
 * subscription-backed session: the sign-in already happened.
 */
export function grokCliAuthPath(): string {
  return path.join(homedir(), ".grok", "auth.json");
}

export async function importGrokCliSession(): Promise<XaiSession> {
  let file: string;
  try {
    file = await readFile(grokCliAuthPath(), "utf8");
  } catch {
    throw new Error("No Grok CLI sign-in found on this machine (~/.grok/auth.json). Sign in with SuperGrok instead.");
  }
  const parsed = JSON.parse(file) as Record<string, unknown>;
  const entry =
    (parsed[`${XAI_OAUTH_ISSUER}::${XAI_OAUTH_CLIENT_ID}`] as Record<string, unknown> | undefined) ??
    (Object.values(parsed).find((value) => {
      const record = value as Record<string, unknown> | null;
      return Boolean(record && typeof record === "object" && (record.key || record.refresh_token));
    }) as Record<string, unknown> | undefined);
  const session = normalizeXaiSession(entry, "cli_import");
  if (!session) throw new Error("The Grok CLI sign-in on this machine has no usable token in it.");
  // Prove it before storing it. A CLI session that has since rotated its
  // refresh token imports cleanly and then fails at the first mint, which
  // reads as "the voice feature is broken" rather than "sign in again".
  if (!session.accessToken || (session.expiresAt && session.expiresAt <= Date.now())) {
    try {
      return await refreshXaiSession(session);
    } catch {
      throw new Error(
        "The Grok CLI sign-in on this machine has expired and its refresh token no longer works. Sign in with SuperGrok instead — it takes one code."
      );
    }
  }
  return writeXaiSession(session);
}

async function postToken(body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(XAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString()
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(
      String(payload.error_description ?? payload.error ?? `xAI sign-in failed (HTTP ${response.status}).`)
    ) as Error & { code?: string; status?: number };
    error.code = typeof payload.error === "string" ? payload.error : undefined;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function refreshXaiSession(current: XaiSession): Promise<XaiSession> {
  if (!current.refreshToken) throw new Error("That Grok sign-in has no refresh token. Sign in again.");
  const payload = await postToken({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
    client_id: XAI_OAUTH_CLIENT_ID
  });
  const next = normalizeXaiSession(
    {
      ...payload,
      email: (payload.email as string) || current.email,
      refresh_token: (payload.refresh_token as string) || current.refreshToken,
      source: current.source
    },
    current.source
  );
  if (!next?.accessToken) throw new Error("The refresh did not return an access token. Sign in again.");
  return writeXaiSession(next);
}

export function xaiSessionUsable(session: XaiSession | null, now = Date.now()): boolean {
  if (!session) return false;
  if (session.accessToken && (!session.expiresAt || session.expiresAt > now)) return true;
  return Boolean(session.refreshToken);
}

function needsRefresh(session: XaiSession, now: number): boolean {
  if (!session.refreshToken) return false;
  if (!session.accessToken) return true;
  if (!session.expiresAt) return false;
  return session.expiresAt - REFRESH_SKEW_MS <= now;
}

/**
 * A live access token for the subscription, importing the Grok CLI's session
 * on first use and refreshing it when it is close to expiry. Empty string
 * means "no subscription connected" — the caller falls back to an API key.
 */
export async function getValidXaiAccessToken(): Promise<string> {
  let session = await readXaiSession();
  if (!session) {
    try {
      session = await importGrokCliSession();
    } catch {
      return "";
    }
  }
  const now = Date.now();
  if (needsRefresh(session, now)) {
    try {
      session = await refreshXaiSession(session);
    } catch (error) {
      if (session.accessToken && session.expiresAt > now) return session.accessToken;
      throw error;
    }
  }
  return session.accessToken && (!session.expiresAt || session.expiresAt > now) ? session.accessToken : "";
}

export type DeviceLogin = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export async function startXaiDeviceLogin(): Promise<DeviceLogin> {
  const response = await fetch(XAI_DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: XAI_OAUTH_CLIENT_ID, scope: XAI_OAUTH_SCOPE }).toString()
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`xAI would not start the sign-in (HTTP ${response.status}). ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as Record<string, unknown>;
  const deviceCode = String(data.device_code ?? "");
  const userCode = String(data.user_code ?? "");
  if (!deviceCode || !userCode) throw new Error("xAI did not return a device code.");
  const verificationUri = String(data.verification_uri ?? "https://accounts.x.ai/oauth2/device");
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: String(
      data.verification_uri_complete ?? `${verificationUri}?user_code=${encodeURIComponent(userCode)}`
    ),
    expiresIn: Number(data.expires_in) || 1800,
    interval: Math.max(1, Number(data.interval) || 5)
  };
}

export async function pollXaiDeviceLogin(
  deviceCode: string
): Promise<{ pending: true; slowDown: boolean } | { pending: false; session: XaiSession }> {
  try {
    const payload = await postToken({
      grant_type: DEVICE_GRANT,
      device_code: deviceCode,
      client_id: XAI_OAUTH_CLIENT_ID
    });
    const session = normalizeXaiSession(payload, "device_code");
    if (!session) throw new Error("The token response had no access or refresh token in it.");
    return { pending: false, session: await writeXaiSession(session) };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "authorization_pending") return { pending: true, slowDown: false };
    if (code === "slow_down") return { pending: true, slowDown: true };
    throw error;
  }
}

export async function describeXaiAuth(): Promise<{ signedIn: boolean; email: string; via: string; message: string }> {
  const session = await readXaiSession();
  if (!session) {
    let cliAvailable = false;
    try {
      await readFile(grokCliAuthPath(), "utf8");
      cliAvailable = true;
    } catch {
      cliAvailable = false;
    }
    return {
      signedIn: false,
      email: "",
      via: cliAvailable ? "cli-available" : "none",
      message: cliAvailable
        ? "Not connected yet — but the Grok CLI is signed in on this machine, so one click imports it."
        : "Not connected. SuperGrok or X Premium covers Grok voice without any API top-up."
    };
  }
  if (!xaiSessionUsable(session)) {
    return { signedIn: false, email: session.email, via: session.source, message: "That Grok sign-in expired. Connect it again." };
  }
  return {
    signedIn: true,
    email: session.email,
    via: session.source,
    message: `Connected as ${session.email || "your Grok account"}${
      session.source === "cli_import" ? ", imported from the Grok CLI on this machine" : ", signed in with SuperGrok"
    }. Voice runs on the subscription.`
  };
}
