/**
 * AI voiceover: turns typed dialogue into an MP3 in Nic's cloned voice via
 * ElevenLabs text-to-speech.
 *
 * House AI pattern: *Configured() gate, pure request builder, graceful
 * fallback (no key configured -> clear error, never a thrown exception).
 */

import { dataPath } from "@/lib/paths";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

export function voiceoverDir() {
  return dataPath("voiceover");
}

export function voiceoverConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
}

/** Calls ElevenLabs text-to-speech and returns the raw MP3 bytes. Throws on failure — callers decide how to record the error. */
export async function synthesizeVoiceover(script: string): Promise<Buffer> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const response = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": process.env.ELEVENLABS_API_KEY as string
    },
    body: JSON.stringify({
      text: script,
      model_id: DEFAULT_MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs rejected the request (${response.status}): ${detail.slice(0, 200) || "no detail"}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
