import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { projectFile } from "@/lib/story/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".srt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json"
};

const ALLOWED = /^(package\/[\w./-]+|cut-checks\/[\w.-]+)$/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const relative = request.nextUrl.searchParams.get("path") ?? "";
  if (!ALLOWED.test(relative) || relative.includes("..")) return NextResponse.json({ error: "Not a package file." }, { status: 400 });
  let file: string;
  let size: number;
  try {
    file = projectFile(id, ...relative.split("/"));
    size = (await stat(file)).size;
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache"
  };
  if (request.nextUrl.searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="${path.basename(file)}"`;
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new NextResponse(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) }
    });
  }
  return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { ...headers, "Content-Length": String(size) }
  });
}
