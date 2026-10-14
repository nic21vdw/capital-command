import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ingestInstagramEvent } from "@/lib/inbox/webhook";
import { publisherConfig } from "@/lib/publisher/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/instagram/webhook — Meta's subscription verification handshake.
 * Configure this URL in the Meta App Dashboard's webhook settings, along
 * with the same value as IG_WEBHOOK_VERIFY_TOKEN.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = publisherConfig().instagram.webhookVerifyToken;
  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

function isValidSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * POST /api/instagram/webhook — receives subscribed events. Comment and
 * mention events are written to the inbox (src/lib/inbox); the poll in
 * src/lib/inbox/sync.ts is the backstop for anything a failed write loses.
 * Meta expects a fast 200; the payload signature is verified against
 * IG_APP_SECRET before anything is trusted, and every event is refused while
 * that secret is unset. This route is exempt from the loopback origin guard
 * in src/middleware.ts for exactly that reason.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const { appSecret } = publisherConfig().instagram;

  if (!appSecret || !isValidSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    console.warn("Instagram webhook: received non-JSON body");
    return new NextResponse("OK", { status: 200 });
  }

  try {
    const stored = await ingestInstagramEvent(payload);
    if (stored > 0) console.log(`[inbox] Instagram webhook stored ${stored} new item(s).`);
  } catch (error) {
    console.warn(`[inbox] Instagram webhook event was not stored (${error instanceof Error ? error.name : "error"}); the next sync will find it.`);
  }

  return new NextResponse("OK", { status: 200 });
}
