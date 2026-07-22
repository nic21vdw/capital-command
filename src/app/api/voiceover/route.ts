import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { voiceoverSchema } from "@/lib/storage/schemas";
import { synthesizeVoiceover, voiceoverConfigured, voiceoverDir } from "@/lib/voiceover/client";
import type { Voiceover } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Synthesizes dialogue in Nic's cloned voice with ElevenLabs and saves the MP3. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const script = typeof body.script === "string" ? body.script.trim() : "";
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Voiceover";
  if (!script) return NextResponse.json({ error: "Type the dialogue you want spoken." }, { status: 400 });

  const id = `voiceover-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  let record: Voiceover;
  if (!voiceoverConfigured()) {
    record = voiceoverSchema.parse({
      id,
      title,
      script,
      status: "failed",
      error: "ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID are not set — add them to .env to generate voiceover.",
      createdAt: now,
      updatedAt: now
    }) as Voiceover;
  } else {
    try {
      const audio = await synthesizeVoiceover(script);
      await mkdir(voiceoverDir(), { recursive: true });
      await writeFile(path.join(voiceoverDir(), `${id}.mp3`), audio);
      record = voiceoverSchema.parse({
        id,
        title,
        script,
        status: "completed",
        audioUrl: `/api/voiceover/${id}/audio`,
        createdAt: now,
        updatedAt: now
      }) as Voiceover;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      record = voiceoverSchema.parse({
        id,
        title,
        script,
        status: "failed",
        error: `Voiceover generation failed (${message}).`,
        createdAt: now,
        updatedAt: now
      }) as Voiceover;
    }
  }

  const data = await readAppData();
  await writeAppData({ ...data, voiceovers: [record, ...(data.voiceovers ?? [])] });
  return NextResponse.json({ voiceover: record, configured: voiceoverConfigured() });
}
