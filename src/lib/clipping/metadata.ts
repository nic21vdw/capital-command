import Anthropic from "@anthropic-ai/sdk";
import type { ClipCandidate, ClipMetadata } from "@/lib/clipping/types";

export function metadataConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const METADATA_SCHEMA = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          clipId: { type: "string" },
          title: { type: "string", description: "Short-form video title, under 80 characters, no clickbait" },
          hook: { type: "string", description: "First line spoken/shown on screen to stop the scroll" },
          description: { type: "string", description: "1-3 sentence YouTube description" },
          caption: { type: "string", description: "Shorts/Reels/TikTok caption, casual tone" },
          hashtags: { type: "array", items: { type: "string" }, description: "3-6 hashtags without the # symbol" }
        },
        required: ["clipId", "title", "hook", "description", "caption", "hashtags"],
        additionalProperties: false
      }
    }
  },
  required: ["clips"],
  additionalProperties: false
} as const;

/**
 * Generates per-clip titles/hooks/captions with Claude. Returns a map from
 * clip id to metadata, or a reason string when generation isn't possible.
 */
export async function generateClipMetadata(
  clips: ClipCandidate[],
  topic: string | undefined,
  transcriptAvailable: boolean
): Promise<{ metadata: Map<string, ClipMetadata> } | { metadata: null; reason: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      metadata: null,
      reason:
        "Metadata suggestions skipped: set ANTHROPIC_API_KEY in .env to generate clip titles, hooks, captions, and hashtags."
    };
  }
  if (!transcriptAvailable && !topic) {
    return {
      metadata: null,
      reason:
        "Metadata suggestions skipped: no transcript and no topic were available. Add a topic when uploading, or set OPENAI_API_KEY to enable transcription."
    };
  }

  const clipDescriptions = clips
    .map((clip) => {
      const lines = [
        `Clip ${clip.id}: ${formatTimestamp(clip.start)}–${formatTimestamp(clip.end)} (${Math.round(clip.end - clip.start)}s).`
      ];
      if (clip.transcriptExcerpt) lines.push(`Transcript: """${clip.transcriptExcerpt}"""`);
      else lines.push("No transcript for this clip — base the metadata on the overall video topic.");
      return lines.join("\n");
    })
    .join("\n\n");

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    system:
      "You write metadata for short-form video clips cut from a longer video. " +
      "Titles and hooks must be attention-grabbing but accurate to the content — never misleading clickbait. " +
      "Keep titles under 80 characters. Captions are casual and platform-native. Hashtags are lowercase, no # symbol.",
    output_config: { format: { type: "json_schema", schema: METADATA_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `${topic ? `Overall video topic: ${topic}\n\n` : ""}Write metadata for each of these clips:\n\n${clipDescriptions}`
      }
    ]
  });

  if (response.stop_reason === "refusal") {
    return { metadata: null, reason: "Metadata suggestions skipped: the model declined this request." };
  }

  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) {
    return { metadata: null, reason: "Metadata suggestions failed: the model returned no text." };
  }

  const parsed = JSON.parse(text) as {
    clips: Array<ClipMetadata & { clipId: string }>;
  };
  const map = new Map<string, ClipMetadata>();
  for (const entry of parsed.clips) {
    map.set(entry.clipId, {
      title: entry.title,
      hook: entry.hook,
      description: entry.description,
      caption: entry.caption,
      hashtags: entry.hashtags
    });
  }
  return { metadata: map };
}

export function formatTimestamp(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
