import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { primaryAccountId } from "@/lib/publisher/accounts";
import { resolveTiktokAvatarFile, tiktokCreatorInfo } from "@/lib/publisher/tiktokAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves the mirrored TikTok profile photo. The CDN URL TikTok hands back
 * dies in a couple of days; the connect flow and tiktokCreatorInfo write the
 * bytes into data/publisher so this route stays stable for the UI.
 */
export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("account") || primaryAccountId("tiktok");
  let file = await resolveTiktokAvatarFile(accountId);
  if (!file) {
    await tiktokCreatorInfo(accountId);
    file = await resolveTiktokAvatarFile(accountId);
  }
  if (!file) {
    return NextResponse.json({ error: "No TikTok avatar is cached yet." }, { status: 404 });
  }

  const size = (await stat(file.path)).size;
  const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=3600"
    }
  });
}
