import { NextResponse } from "next/server";
import { CONNECTIONS, CONNECTION_FIELD_NAMES } from "@/lib/publisher/connections";
import { credentialSources, credentialsPresent, saveCredentials } from "@/lib/publisher/credentials";
import { accountIdConfigured } from "@/lib/publisher/accounts";
import { googleRedirectUri } from "@/lib/publisher/googleAuth";
import { tiktokRedirectUri } from "@/lib/publisher/tiktokAuth";
import { spotifyConnected, spotifyRedirectUri } from "@/lib/spotify/auth";
import {
  changesThreadsCredentials,
  readThreadsCredentialRecovery,
  ThreadsCredentialRecoveryError,
  withPausedThreadsCredentialChange
} from "@/lib/threads/credentialRecovery";

/**
 * What is connected, and the one place a credential is written.
 *
 * GET answers with presence only - a boolean per credential name. The values
 * never leave the machine, so a screenshot of Settings cannot leak a token and
 * neither can the browser's network tab.
 */
export async function GET(request: Request) {
  return NextResponse.json(await connectionState(new URL(request.url).origin));
}

/**
 * The redirect URI to register in each provider's console, built by the same
 * helpers the sign-in routes use so it is the one the provider will be sent.
 * Computed here rather than in the browser because TikTok and Spotify each
 * have an environment override and Spotify rewrites localhost.
 */
function redirectUris(origin: string) {
  return {
    youtube: googleRedirectUri(origin),
    tiktok: tiktokRedirectUri(origin),
    spotify: spotifyRedirectUri(origin)
  };
}

async function connectionState(origin: string) {
  const [present, sources, youtube, tiktok, spotify] = await Promise.all([
    credentialsPresent(CONNECTION_FIELD_NAMES),
    credentialSources(CONNECTION_FIELD_NAMES),
    accountIdConfigured("youtube"),
    accountIdConfigured("tiktok"),
    spotifyConnected()
  ]);
  return {
    present, sources, connected: { youtube, tiktok, spotify }, redirectUris: redirectUris(origin),
    threadsRecovery: await readThreadsCredentialRecovery(sources)
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const values = (body as { values?: unknown } | null)?.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return NextResponse.json({ error: "Expected { values: { NAME: string } }." }, { status: 400 });
  }

  // Only names this app actually reads. Without this the endpoint would write
  // any environment variable a request named, which is a way to reconfigure the
  // process from the browser rather than a way to connect an account.
  const allowed = new Set(CONNECTION_FIELD_NAMES);
  const updates: Record<string, string> = {};
  for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
    if (!allowed.has(name)) {
      return NextResponse.json({ error: "An unknown credential name was supplied." }, { status: 400 });
    }
    if (typeof value !== "string") {
      return NextResponse.json({ error: `${name} must be a string.` }, { status: 400 });
    }
    updates[name] = value;
  }

  const threadsChange = changesThreadsCredentials(Object.keys(updates));
  const save = async () => {
    // Re-read ownership inside the control transaction. Environment-owned
    // fields must never be overridden or rewritten by Settings.
    const sources = await credentialSources(CONNECTION_FIELD_NAMES);
    const fromEnv = Object.keys(updates).filter((name) => sources[name] === "env");
    if (fromEnv.length > 0) {
      return NextResponse.json({
        error: `${fromEnv.join(", ")} ${fromEnv.length === 1 ? "is" : "are"} set in .env - edit ${fromEnv.length === 1 ? "it" : "them"} there.` +
          (threadsChange ? " Keep Threads paused while the owner replaces credentials at their source and restarts the app. Review pending and uncertain sends before separately resuming." : ""),
        ...(threadsChange ? { code: "env_owned", threadsRecovery: await readThreadsCredentialRecovery(sources) } : {})
      }, { status: 409 });
    }
    await saveCredentials(updates);
    return null;
  };

  try {
    const refusal = threadsChange ? await withPausedThreadsCredentialChange(save) : await save();
    if (refusal) return refusal;
  } catch (error) {
    if (!threadsChange) throw error;
    // Disk/lock errors can contain paths or values. Only controlled messages
    // leave this endpoint; no secret or raw exception is logged or echoed.
    const recoveryError = error instanceof ThreadsCredentialRecoveryError;
    return NextResponse.json({
      error: recoveryError ? error.message : "The Threads credential save could not be confirmed. Reload account setup before retrying; keep Threads paused.",
      code: recoveryError ? error.code : "threads_save_unconfirmed",
      threadsRecovery: await readThreadsCredentialRecovery(await credentialSources(CONNECTION_FIELD_NAMES))
    }, { status: recoveryError ? 409 : 503 });
  }

  return NextResponse.json({
    ...(await connectionState(new URL(request.url).origin)),
    connections: CONNECTIONS.map((connection) => connection.id)
  });
}
