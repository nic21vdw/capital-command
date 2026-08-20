import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Is the TikTok app out of audit yet?
 *
 * TikTok exposes no endpoint for "has my app been approved" - the developer
 * portal is the only place that says so, and it needs a logged-in browser. So
 * ask the API the question that actually matters instead: try to open a Direct
 * Post. An unaudited client is refused with
 * unaudited_client_can_only_post_to_private_accounts; anything else means the
 * gate is gone.
 *
 * This only calls init. It never uploads bytes, so nothing reaches the account
 * and nothing lands in the creator's inbox either way.
 *
 *   npx tsx src/lib/publisher/auditCheck.ts
 *
 * Exit code 0 = approved, 10 = still unaudited, 11 = pointed at the sandbox
 * app, whose answer can never change, 1 = could not tell.
 */

// Runs outside Next, so load .env the way the publisher CLI does.
function loadDotEnv() {
  try {
    for (const line of readFileSync(path.join(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) continue;
      if (!(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {
    // No .env - fall back to whatever the environment already carries.
  }
}

const API = "https://open.tiktokapis.com/v2";
const REFRESH_KEY = "tiktok.refreshToken";

async function main() {
  loadDotEnv();
  const { publisherConfig } = await import("@/lib/publisher/config");
  const { getCachedToken, setCachedToken } = await import("@/lib/publisher/tokens");

  const { tiktok } = publisherConfig();
  const refreshToken = (await getCachedToken(REFRESH_KEY)) ?? tiktok.refreshToken;
  if (!tiktok.clientKey || !tiktok.clientSecret || !refreshToken) {
    console.log("UNKNOWN - TikTok is not connected.");
    process.exitCode = 1;
    return;
  }
  const sandbox = tiktok.clientKey.startsWith("sbaw");

  const tokenRes = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: tiktok.clientKey,
      client_secret: tiktok.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  const token = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
  };
  if (!token.access_token) {
    console.log(`UNKNOWN - token refresh failed: ${token.error_description ?? "no access_token"}`);
    process.exitCode = 1;
    return;
  }
  // TikTok rotates the refresh token on use. Dropping the new one strands the
  // connection until someone reconnects by hand, so persist it.
  if (token.refresh_token && token.refresh_token !== refreshToken) {
    await setCachedToken(REFRESH_KEY, token.refresh_token);
  }

  const res = await fetch(`${API}/post/publish/video/init/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        title: "audit probe",
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      },
      // A minimal single-chunk descriptor. Init is as far as this goes - no
      // bytes are ever PUT to the upload_url, so no post and no inbox item.
      source_info: { source: "FILE_UPLOAD", video_size: 1048576, chunk_size: 1048576, total_chunk_count: 1 }
    })
  });
  const body = await res.text();

  if (body.includes("unaudited_client_can_only_post_to_private_accounts")) {
    if (sandbox) {
      console.log(
        "SANDBOX - TIKTOK_CLIENT_KEY is the sandbox app's key, and a sandbox app is unaudited by definition: this refusal will never lift, however the production review goes. Approval applies to the production app, so it only reaches this machine once TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are the production pair - the TIKTOK_AUDITED flag on its own changes nothing. See docs/TIKTOK.md."
      );
      process.exitCode = 11;
      return;
    }
    console.log(
      "NOT_APPROVED - Direct Post is still refused. That reads the same whether the review is queued or was rejected - developers.tiktok.com/apps is the only place that says which."
    );
    process.exitCode = 10;
    return;
  }
  if (res.ok) {
    console.log("APPROVED - Direct Post is open. Set TIKTOK_AUDITED=true to publish automatically.");
    return;
  }
  console.log(`UNKNOWN - HTTP ${res.status}: ${body.slice(0, 300)}`);
  process.exitCode = 1;
}

void main();
