import { NextResponse } from "next/server";
import { CONNECTIONS, CONNECTION_FIELD_NAMES } from "@/lib/publisher/connections";
import { credentialSources, credentialsPresent, saveCredentials } from "@/lib/publisher/credentials";
import { accountIdConfigured } from "@/lib/publisher/accounts";
import { googleRedirectUri } from "@/lib/publisher/googleAuth";
import { linkedinConnected, linkedinRedirectUri } from "@/lib/publisher/linkedinAuth";
import { tiktokRedirectUri } from "@/lib/publisher/tiktokAuth";
import { spotifyConnected, spotifyRedirectUri } from "@/lib/spotify/auth";

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
    spotify: spotifyRedirectUri(origin),
    linkedin: linkedinRedirectUri(origin)
  };
}

async function connectionState(origin: string) {
  const [present, sources, youtube, tiktok, spotify, linkedin] = await Promise.all([
    credentialsPresent(CONNECTION_FIELD_NAMES),
    credentialSources(CONNECTION_FIELD_NAMES),
    accountIdConfigured("youtube"),
    accountIdConfigured("tiktok"),
    spotifyConnected(),
    linkedinConnected()
  ]);
  return { present, sources, connected: { youtube, tiktok, spotify, linkedin }, redirectUris: redirectUris(origin) };
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
      return NextResponse.json({ error: `${name} is not a credential this app uses.` }, { status: 400 });
    }
    if (typeof value !== "string") {
      return NextResponse.json({ error: `${name} must be a string.` }, { status: 400 });
    }
    updates[name] = value;
  }

  // A value that .env also sets is read from .env on every start, so saving it
  // here would look like it worked and then revert after the next restart.
  const sources = await credentialSources(Object.keys(updates));
  const fromEnv = Object.keys(updates).filter((name) => sources[name] === "env");
  if (fromEnv.length > 0) {
    return NextResponse.json(
      { error: `${fromEnv.join(", ")} ${fromEnv.length === 1 ? "is" : "are"} set in .env - edit ${fromEnv.length === 1 ? "it" : "them"} there.` },
      { status: 409 }
    );
  }

  await saveCredentials(updates);
  return NextResponse.json({
    ...(await connectionState(new URL(request.url).origin)),
    connections: CONNECTIONS.map((connection) => connection.id)
  });
}
