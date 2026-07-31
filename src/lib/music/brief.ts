import { aiConfigured, runAi } from "@/lib/ai";

/**
 * Turns a one-line idea ("chill beat for a build stream recap") into the
 * three fields Suno actually wants: a title, a comma-separated style tag list
 * and a prompt. Same shape as the clip titler — Claude/DeepSeek writes it,
 * and a local heuristic covers the offline case so the Generate button never
 * depends on the AI gateway being reachable.
 */

const SONG_BRIEF_SYSTEM_PROMPT = `You write briefs for Suno, an AI music generator, for a creator who makes long-form YouTube videos about building software with AI coding tools.

The music is BACKGROUND for talking-head and screen-recording footage, so it must:
- Sit under a voice: steady, loopable, no sudden drops, no big drama.
- Stay instrumental unless the idea explicitly asks for vocals.
- Have a clear genre and mood so the whole library sounds like one channel.

Return strict JSON only: {"title": "...", "style": "...", "prompt": "..."}
- title: 2-5 words, Title Case, no quotes or emoji.
- style: 4-8 comma-separated tags (genre, instruments, mood, tempo).
- prompt: one or two sentences describing the track and how it should feel under narration.`;

export type SongBrief = {
  title: string;
  style: string;
  prompt: string;
};

const FALLBACK_STYLE = "lo-fi hip hop, warm rhodes keys, soft drums, mellow, steady, instrumental";

export function songBriefConfigured() {
  return aiConfigured();
}

function titleFromIdea(idea: string): string {
  const words = idea
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (words.length === 0) return "Background Loop";
  return words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

/** The offline brief: the idea becomes the prompt, with the house style. */
export function heuristicSongBrief(idea: string): SongBrief {
  const trimmed = idea.replace(/\s+/g, " ").trim();
  return {
    title: titleFromIdea(trimmed),
    style: FALLBACK_STYLE,
    prompt: trimmed
      ? `${trimmed}. Steady, loopable background instrumental that sits under a speaking voice without competing with it.`
      : "Steady, loopable lo-fi instrumental that sits under a speaking voice without competing with it."
  };
}

/** Pulls the brief object out of the model's reply, tolerating fences/prose. */
export function parseSongBrief(text: string): SongBrief | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as Partial<SongBrief>;
    const title = typeof parsed.title === "string" ? parsed.title.replace(/["“”]/g, "").trim() : "";
    const style = typeof parsed.style === "string" ? parsed.style.trim() : "";
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
    if (!title || !style || !prompt) return null;
    return { title: title.slice(0, 60), style: style.slice(0, 200), prompt: prompt.slice(0, 600) };
  } catch {
    return null;
  }
}

/** Writes the brief, falling back to the heuristic whenever AI is unavailable. */
export async function writeSongBrief(idea: string): Promise<SongBrief> {
  if (!songBriefConfigured()) return heuristicSongBrief(idea);
  try {
    const result = await runAi({
      maxTokens: 400,
      system: SONG_BRIEF_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Write the Suno brief for this idea:\n\n${idea.trim()}` }]
    });
    if (!result || result.refused) return heuristicSongBrief(idea);
    return parseSongBrief(result.text) ?? heuristicSongBrief(idea);
  } catch {
    return heuristicSongBrief(idea);
  }
}
