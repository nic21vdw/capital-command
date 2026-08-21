import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { candidateFilePath, thumbnailWorkDir } from "@/lib/longform/thumbnail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; frameId: string }> }
) {
  const { projectId, frameId } = await params;
  if (!/^[a-z0-9-]{1,64}$/i.test(frameId)) {
    return NextResponse.json({ error: "Bad frame id." }, { status: 400 });
  }

  const face = request.nextUrl.searchParams.get("face") === "1";
  const filePath = candidateFilePath(projectId, frameId, face);
  if (!path.resolve(filePath).startsWith(path.resolve(thumbnailWorkDir(projectId)))) {
    return NextResponse.json({ error: "Bad frame id." }, { status: 400 });
  }

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "That frame has been cleared — sample again." }, { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=3600"
    }
  });
}
