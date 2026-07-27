import { rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { voiceoverDir } from "@/lib/voiceover/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deletes a voiceover record and its audio file. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await readAppData();
  const voiceovers = data.voiceovers ?? [];
  if (!voiceovers.some((entry) => entry.id === id)) {
    return NextResponse.json({ error: "Voiceover not found." }, { status: 404 });
  }
  await rm(path.join(voiceoverDir(), `${id}.mp3`), { force: true });
  await writeAppData({ ...data, voiceovers: voiceovers.filter((entry) => entry.id !== id) });
  return NextResponse.json({ ok: true });
}
