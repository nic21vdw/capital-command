/**
 * The music model registry. Every model runs on fal's queue API, so the
 * transport is shared (fal.ts) and the only thing that differs per model is
 * the shape of its input and where the audio sits in its output — which is
 * exactly what lives here.
 *
 * Adding a model is one entry: its capabilities (so the studio form knows
 * which controls to show), a pure `buildInput`, and a pure `readAudio`. Both
 * are pure so the whole registry is testable without touching the network.
 */

export type MusicModelId =
  | "lyria3-pro"
  | "ace-step"
  | "minimax-2-6"
  | "cassette"
  | "sonilo";

/** How a model handles vocals. */
export type VocalSupport =
  /** Dedicated lyrics field. */
  | "field"
  /** Lyrics go inside the prompt. */
  | "prompt"
  /** Instrumental only — no vocals at all. */
  | "none";

export type DurationRange = { min: number; max: number; default: number };

export type MusicModel = {
  id: MusicModelId;
  /** fal endpoint id — also the queue path. */
  endpointId: string;
  label: string;
  vendor: string;
  /** One line for the model card in the studio. */
  blurb: string;
  /** What the prompt box should be called for this model. */
  promptLabel: string;
  promptPlaceholder: string;
  /** Null when the model decides its own length. */
  duration: DurationRange | null;
  vocals: VocalSupport;
  /** Most models return one take; sonilo can return up to three. */
  maxSamples: number;
  /** Container the model returns, for the library file name. */
  extension: string;
};

export const MUSIC_MODELS: MusicModel[] = [
  {
    id: "lyria3-pro",
    endpointId: "fal-ai/lyria3/pro",
    label: "Lyria 3 Pro",
    vendor: "Google",
    blurb: "Full, structured songs up to 3 minutes. The most produced-sounding of the five, and the one to reach for when the music is the point.",
    promptLabel: "Describe the song",
    promptPlaceholder:
      "Warm lo-fi hip hop for a coding stream recap — rhodes keys, soft brushed drums, 82 BPM, nostalgic and steady, no vocals",
    duration: null,
    vocals: "prompt",
    maxSamples: 1,
    extension: ".mp3"
  },
  {
    id: "sonilo",
    endpointId: "sonilo/v1.1/text-to-music",
    label: "Sonilo v1.1",
    vendor: "Sonilo",
    blurb: "Up to 10 minutes in one call and up to 3 takes at once — the long-underscore workhorse for a full video bed.",
    promptLabel: "Describe the music",
    promptPlaceholder: "Neo-soul underscore, warm rhodes, brushed drums, unhurried, sits under narration",
    duration: { min: 30, max: 600, default: 180 },
    vocals: "none",
    maxSamples: 3,
    extension: ".m4a"
  },
  {
    id: "ace-step",
    endpointId: "fal-ai/ace-step",
    label: "ACE-Step",
    vendor: "ACE Studio",
    blurb: "Tag-driven and fast, with real lyric control and any length up to 4 minutes. Best when you know the genre you want.",
    promptLabel: "Genre tags",
    promptPlaceholder: "lofi, hiphop, chill, rhodes, boom bap",
    duration: { min: 5, max: 240, default: 60 },
    vocals: "field",
    maxSamples: 1,
    extension: ".wav"
  },
  {
    id: "minimax-2-6",
    endpointId: "fal-ai/minimax-music/v2.6",
    label: "MiniMax Music 2.6",
    vendor: "MiniMax",
    blurb: "Strong vocals and song structure, with an instrumental switch and a lyric writer built in.",
    promptLabel: "Describe the music",
    promptPlaceholder: "City pop, 80s retro, groovy synth bass, 104 BPM, nostalgic urban night",
    duration: null,
    vocals: "field",
    maxSamples: 1,
    extension: ".mp3"
  },
  {
    id: "cassette",
    endpointId: "cassetteai/music-generator",
    label: "CassetteAI",
    vendor: "Cassette",
    blurb: "Quick instrumental beds up to 3 minutes. The cheap, fast option for background music nobody is meant to notice.",
    promptLabel: "Describe the beat",
    promptPlaceholder: "Smooth chill hip-hop beat, mellow piano, deep bass, soft drums. Key: D Minor, Tempo: 90 BPM.",
    duration: { min: 10, max: 180, default: 90 },
    vocals: "none",
    maxSamples: 1,
    extension: ".wav"
  }
];

export function getMusicModel(id: string): MusicModel | null {
  return MUSIC_MODELS.find((model) => model.id === id) ?? null;
}

export type StudioRequest = {
  modelId: MusicModelId;
  /** Prompt or, for ACE-Step, the genre tag list. */
  prompt: string;
  /** Only meaningful when the model's `vocals` is "field" or "prompt". */
  lyrics?: string;
  instrumental: boolean;
  durationSec?: number;
  samples?: number;
};

function clampDuration(model: MusicModel, requested: number | undefined): number | undefined {
  if (!model.duration) return undefined;
  const { min, max, default: fallback } = model.duration;
  const value = typeof requested === "number" && Number.isFinite(requested) ? requested : fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** MiniMax rejects a prompt under 10 characters, so pad a terse one. */
const MINIMAX_MIN_PROMPT = 10;

/**
 * Turns one studio request into the body a specific model expects. Pure.
 *
 * Models that have no instrumental switch of their own get the instruction
 * folded into the prompt instead, so the toggle means the same thing in the
 * UI whichever model is selected.
 */
export function buildModelInput(model: MusicModel, request: StudioRequest): Record<string, unknown> {
  const prompt = request.prompt.trim();
  const lyrics = request.lyrics?.trim() ?? "";
  const wantsVocals = !request.instrumental && model.vocals !== "none";
  const duration = clampDuration(model, request.durationSec);

  switch (model.id) {
    case "lyria3-pro": {
      // Lyria takes everything as prose, so the toggle and any lyrics are
      // appended as instructions rather than sent as separate fields.
      const parts = [prompt];
      if (wantsVocals && lyrics) parts.push(`Lyrics:\n${lyrics}`);
      if (!wantsVocals) parts.push("Instrumental only, no vocals.");
      return { prompt: parts.join("\n\n").slice(0, 5000) };
    }
    case "ace-step":
      return {
        tags: prompt,
        // "[inst]" is ACE-Step's own marker for "sing nothing".
        lyrics: wantsVocals && lyrics ? lyrics : "[inst]",
        duration
      };
    case "minimax-2-6": {
      const padded = prompt.length >= MINIMAX_MIN_PROMPT ? prompt : `${prompt} background music`;
      return {
        prompt: padded.slice(0, 2000),
        is_instrumental: !wantsVocals,
        // A vocal track MUST carry lyrics; let the model write them when the
        // user didn't, rather than failing validation.
        lyrics: wantsVocals ? lyrics : "",
        lyrics_optimizer: wantsVocals && !lyrics,
        audio_setting: { format: "mp3", bitrate: 256000, sample_rate: 44100 }
      };
    }
    case "cassette":
      return { prompt, duration };
    case "sonilo":
      return {
        prompt,
        duration,
        num_samples: Math.min(model.maxSamples, Math.max(1, Math.round(request.samples ?? 1)))
      };
  }
}

export type GeneratedAudio = { url: string; contentType?: string; fileName?: string };

type FalFile = { url?: string; content_type?: string; file_name?: string };

function readFile(value: unknown): GeneratedAudio | null {
  const file = value as FalFile | undefined;
  if (!file?.url) return null;
  return { url: file.url, contentType: file.content_type, fileName: file.file_name };
}

/**
 * Pulls every finished take out of a model's output. The audio hides under a
 * different key per model — `audio`, `audio_file`, or an `audios` array — so
 * this is the other half of what makes one studio drive five models. Pure.
 */
export function readModelAudio(model: MusicModel, output: unknown): GeneratedAudio[] {
  const body = output as Record<string, unknown> | null;
  if (!body) return [];

  if (model.id === "cassette") {
    const single = readFile(body.audio_file);
    return single ? [single] : [];
  }
  if (model.id === "sonilo") {
    const list = Array.isArray(body.audios) ? body.audios : [];
    const takes = list.map(readFile).filter((take): take is GeneratedAudio => Boolean(take));
    if (takes.length > 0) return takes;
  }
  const single = readFile(body.audio);
  return single ? [single] : [];
}
