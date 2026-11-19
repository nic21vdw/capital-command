import { NextResponse } from "next/server";
import { CONNECTIONS, CONNECTION_FIELD_NAMES } from "@/lib/publisher/connections";
import { SERVICE_FIELD_NAMES } from "@/lib/setup/services";

const SETUP_FIELD_NAMES = [...CONNECTION_FIELD_NAMES, ...SERVICE_FIELD_NAMES];
import { CredentialStoreReadError, credentialSources, credentialsPresent, saveCredentials } from "@/lib/publisher/credentials";
import { accountIdConfigured } from "@/lib/publisher/accounts";
import { googleRedirectUri } from "@/lib/publisher/googleAuth";
import { linkedinConnected, linkedinRedirectUri } from "@/lib/publisher/linkedinAuth";
import { tiktokRedirectUri } from "@/lib/publisher/tiktokAuth";
import { spotifyConnected, spotifyRedirectUri } from "@/lib/spotify/auth";
import { findAccount, threadsConfig } from "@/lib/threads/config";
import {
  savedThreadsConnectionHealth, ThreadsConnectionError, verifyThreadsPublishingConnection,
  type ThreadsConnectionHealth
} from "@/lib/threads/reconnect";
import {
  changesThreadsCredentials,
  readThreadsCredentialRecovery,
  ThreadsCredentialRecoveryError,
  withPausedThreadsCredentialChange
} from "@/lib/threads/credentialRecovery";

/**
 * What is connected, and the one place a credential is written.
 *
 * GET answers with credential presence and stored account status. It never
 * checks a provider or returns a saved credential.
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
    spotify: spotifyRedirectUri(origin),
    linkedin: linkedinRedirectUri(origin)
  };
}

async function connectionState(origin: string, threadsConnection?: ThreadsConnectionHealth) {
  const [present, sources, youtube, tiktok, spotify, linkedin] = await Promise.all([
    credentialsPresent(SETUP_FIELD_NAMES),
    credentialSources(SETUP_FIELD_NAMES),
    accountIdConfigured("youtube"),
    accountIdConfigured("tiktok"),
    spotifyConnected(),
    linkedinConnected()
  ]);
  return {
    present, sources, connected: { youtube, tiktok, spotify, linkedin }, redirectUris: redirectUris(origin),
    threadsRecovery: await readThreadsCredentialRecovery(sources),
    threadsConnection: threadsConnection ?? await savedThreadsConnectionHealth()
  };
}

function threadsCheckFailure(error: ThreadsConnectionError) {
  const threadsConnection: ThreadsConnectionHealth = error.code === "threads_reauth_required"
    ? { state: "reauth_required" }
    : { state: "check_failed", code: error.code };
  return NextResponse.json({ error: error.message, code: error.code, threadsConnection }, {
    status: error.code === "threads_probe_unavailable" ? 503 : 409
  });
}

function verifiedConnection(profile: { username: string; userId: string }): ThreadsConnectionHealth {
  return { state: "verified", username: profile.username, userId: profile.userId, checkedAt: new Date().toISOString() };
}

async function checkThreadsConnection(origin: string, username: string | null) {
  const config = threadsConfig();
  const account = findAccount(config, "primary");
  if (!account) return threadsCheckFailure(new ThreadsConnectionError("threads_reauth_required"));
  try {
    const verified = await verifyThreadsPublishingConnection(account, config, { userId: account.userId, username });
    const latest = findAccount(threadsConfig(), account.id);
    if (!latest || latest.accessToken !== account.accessToken || latest.userId !== account.userId) {
      throw new ThreadsConnectionError("threads_probe_unavailable");
    }
    return NextResponse.json(await connectionState(origin, verifiedConnection(verified)));
  } catch (error) {
    if (error instanceof ThreadsConnectionError) return threadsCheckFailure(error);
    throw error;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const input = body as { values?: unknown; checkThreads?: unknown; threadsHandle?: unknown } | null;
  const origin = new URL(request.url).origin;
  const threadsHandle = typeof input?.threadsHandle === "string" ? input.threadsHandle : null;
  if (input?.checkThreads === true && input.values === undefined) return checkThreadsConnection(origin, threadsHandle);
  const values = input?.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return NextResponse.json({ error: "Expected { values: { NAME: string } }." }, { status: 400 });
  }

  // Only names this app actually reads. Without this the endpoint would write
  // any environment variable a request named, which is a way to reconfigure the
  // process from the browser rather than a way to connect an account.
  const allowed = new Set(SETUP_FIELD_NAMES);
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
  let threadsConnection: ThreadsConnectionHealth | undefined;
  const save = async () => {
    // Re-read ownership inside the control transaction. Environment-owned
    // fields must never be overridden or rewritten by Settings.
    const sources = await credentialSources(SETUP_FIELD_NAMES);
    const fromEnv = Object.keys(updates).filter((name) => sources[name] === "env");
    if (fromEnv.length > 0) {
      return NextResponse.json({
        error: `${fromEnv.join(", ")} ${fromEnv.length === 1 ? "is" : "are"} set in .env - edit ${fromEnv.length === 1 ? "it" : "them"} there.` +
          (threadsChange ? " Keep Threads paused while the owner replaces credentials at their source and restarts the app. Review pending and uncertain sends before separately resuming." : ""),
        ...(threadsChange ? { code: "env_owned", threadsRecovery: await readThreadsCredentialRecovery(sources) } : {})
      }, { status: 409 });
    }
    if (!threadsChange) {
      await saveCredentials(updates);
      return null;
    }

    await saveCredentials(updates, {
      strict: true,
      prepare: async (current): Promise<Record<string, string>> => {
        const userId = sources.THREADS_USER_ID === "env"
          ? process.env.THREADS_USER_ID?.trim()
          : current.THREADS_USER_ID?.trim();
        const requestedId = updates.THREADS_USER_ID?.trim();
        // A reconnect must not redirect an existing queue to another profile.
        if (userId && updates.THREADS_USER_ID !== undefined && requestedId !== userId) {
          throw new ThreadsConnectionError("threads_profile_mismatch");
        }
        const config = threadsConfig();
        const previous = findAccount(config, "primary");
        const sourceToken = sources.THREADS_ACCESS_TOKEN === "env"
          ? previous?.accessToken
          : current.THREADS_ACCESS_TOKEN === process.env.THREADS_ACCESS_TOKEN
            ? previous?.accessToken
            : current.THREADS_ACCESS_TOKEN;
        const accessToken = updates.THREADS_ACCESS_TOKEN?.trim() ?? sourceToken;
        if (!accessToken) {
          // A deliberate removal makes no provider request and leaves the
          // numeric profile binding intact for the next reconnect.
          if (updates.THREADS_ACCESS_TOKEN === "" && updates.THREADS_USER_ID === undefined) return {};
          throw new ThreadsConnectionError("threads_reauth_required");
        }
        const account = {
          id: "primary", label: "Threads", posts: "text" as const,
          offsetMinutes: 0, ...previous, accessToken, userId: userId ?? null
        };
        const checked = await verifyThreadsPublishingConnection(account, config, { userId: userId || requestedId, username: threadsHandle });
        threadsConnection = verifiedConnection(checked);
        return sources.THREADS_USER_ID === "env" ? {} : { THREADS_USER_ID: checked.userId };
      }
    });
    return null;
  };

  try {
    const refusal = threadsChange ? await withPausedThreadsCredentialChange(save) : await save();
    if (refusal) return refusal;
  } catch (error) {
    if (!threadsChange) throw error;
    if (error instanceof ThreadsConnectionError) return threadsCheckFailure(error);
    // Disk/lock errors can contain paths or values. Only controlled messages
    // leave this endpoint; no secret or raw exception is logged or echoed.
    const recoveryError = error instanceof ThreadsCredentialRecoveryError;
    const storeError = error instanceof CredentialStoreReadError;
    const status = storeError || (recoveryError && error.code !== "threads_controls_busy") ? 409 : 503;
    return NextResponse.json({
      error: recoveryError ? error.message : storeError ? "The saved credentials could not be read safely. Keep Threads paused and ask the owner to repair the credential store before saving." : "The Threads credential save could not be confirmed. Reload account setup before retrying; keep Threads paused.",
      code: recoveryError ? error.code : storeError ? "credential_store_unavailable" : "threads_save_unconfirmed",
      threadsRecovery: await readThreadsCredentialRecovery(await credentialSources(CONNECTION_FIELD_NAMES))
    }, { status });
  }

  return NextResponse.json({
    ...(await connectionState(origin, threadsConnection)),
    connections: CONNECTIONS.map((connection) => connection.id)
  });
}
