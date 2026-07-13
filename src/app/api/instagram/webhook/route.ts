import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
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
 * POST /api/instagram/webhook — receives subscribed events (comments,
 * mentions, messages, etc). Meta expects a fast 200; verify the payload
 * signature (when IG_APP_SECRET is set) before trusting it, then hand off
 * to whatever processing this app needs.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const { appSecret } = publisherConfig().instagram;

  if (appSecret) {
    const signature = request.headers.get("x-hub-signature-256");
    if (!isValidSignature(rawBody, signature, appSecret)) {
      return new NextResponse("Invalid signature", { status: 401 });
    }
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    console.log("Instagram webhook event:", JSON.stringify(payload));
  } catch {
    console.warn("Instagram webhook: received non-JSON body");
  }

  return new NextResponse("OK", { status: 200 });
}
