import { NextResponse } from "next/server";
import { CONNECTIONS, CONNECTION_FIELD_NAMES } from "@/lib/publisher/connections";
import { credentialsPresent, saveCredentials } from "@/lib/publisher/credentials";

/**
 * What is connected, and the one place a credential is written.
 *
 * GET answers with presence only - a boolean per credential name. The values
 * never leave the machine, so a screenshot of Settings cannot leak a token and
 * neither can the browser's network tab.
 */
export async function GET() {
  return NextResponse.json({ present: await credentialsPresent(CONNECTION_FIELD_NAMES) });
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

  await saveCredentials(updates);
  return NextResponse.json({
    present: await credentialsPresent(CONNECTION_FIELD_NAMES),
    connections: CONNECTIONS.map((connection) => connection.id)
  });
}
