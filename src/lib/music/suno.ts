/**
 * Suno song generation: turns a text brief into a finished MP3 for the
 * long-form background-music library.
 *
 * Suno has NO official self-serve API — as of July 2026 the company is only
 * piloting a developer API with a curated set of partners. Everything public
 * goes through a gateway that fronts Suno (sunoapi.org, kie.ai and friends),
 * and they all speak the same two routes, so this client is written against
 * that shape with the host behind SUNO_API_BASE. If Suno ships its own API,
 * this file is the only place that has to change.
 *
 * House AI pattern: *Configured() gate, pure request builder, graceful
 * fallback (no key configured -> clear error, never a thrown exception).
 */

const DEFAULT_SUNO_API_BASE = "https://api.sunoapi.org";
const DEFAULT_SUNO_MODEL = "V5";

export type SunoSongRequest = {
  /** Free-text description of the song, or the lyrics when in custom mode. */
  prompt: string;
  /** Genre/mood tags, e.g. "lo-fi hip hop, warm keys, relaxed". */
  style?: string;
  /** Track title. */
  title?: string;
  /** Instrumental only — no vocals. The default for background music. */
  instrumental?: boolean;
  /** Model version override; defaults to SUNO_MODEL or V5. */
  model?: string;
};

export type SunoSong = {
  id: string;
  title: string;
  audioUrl: string;
  imageUrl?: string;
  tags?: string;
  durationSec?: number;
};

export type SunoJobState =
  | { status: "pending"; songs: [] }
  | { status: "complete"; songs: SunoSong[] }
  | { status: "failed"; songs: []; error: string };

export function sunoConfigured() {
  return Boolean(process.env.SUNO_API_KEY);
}

export function sunoApiBase() {
  return (process.env.SUNO_API_BASE || DEFAULT_SUNO_API_BASE).replace(/\/+$/, "");
}

export function sunoModel() {
  return process.env.SUNO_MODEL || DEFAULT_SUNO_MODEL;
}

/**
 * Builds the generate payload. Two shapes exist: description mode, where the
 * prompt IS the whole brief, and custom mode, which takes a style and title
 * of their own. An instrumental with both of those is the background-music
 * case, so it gets custom mode; anything else stays in description mode where
 * a single sentence is enough. Pure, for tests.
 */
export function buildGenerateBody(input: SunoSongRequest, model = sunoModel()) {
  const instrumental = Boolean(input.instrumental);
  const style = input.style?.trim();
  const title = input.title?.trim();
  const custom = Boolean(instrumental && style && title);
  return {
    customMode: custom,
    instrumental,
    model,
    prompt: custom ? undefined : input.prompt.trim(),
    style: custom ? style : undefined,
    title: custom ? title : undefined
  };
}

/** Reads the gateway's task-status value into our three-state job status. */
export function readJobStatus(raw: string | undefined): "pending" | "complete" | "failed" {
  const status = (raw ?? "").toUpperCase();
  if (status === "SUCCESS") return "complete";
  if (status.includes("FAIL") || status.includes("ERROR")) return "failed";
  return "pending";
}

type GenerateResponse = { code?: number; msg?: string; data?: { taskId?: string } };

type RecordInfoResponse = {
  code?: number;
  msg?: string;
  data?: {
    status?: string;
    errorMessage?: string;
    response?: {
      sunoData?: Array<{
        id?: string;
        title?: string;
        audioUrl?: string;
        streamAudioUrl?: string;
        sourceAudioUrl?: string;
        imageUrl?: string;
        tags?: string;
        duration?: number;
      }>;
    };
  };
};

/** Submits a song for generation. Never throws. */
export async function submitSongJob(input: SunoSongRequest): Promise<{ taskId: string | null; error: string | null }> {
  if (!sunoConfigured()) {
    return { taskId: null, error: "SUNO_API_KEY is not set — add it to .env to generate songs." };
  }
  try {
    const response = await fetch(`${sunoApiBase()}/api/v1/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUNO_API_KEY}`
      },
      body: JSON.stringify(buildGenerateBody(input))
    });
    const data = (await response.json().catch(() => null)) as GenerateResponse | null;
    if (!response.ok || (data?.code && data.code !== 200)) {
      const detail = data?.msg || `HTTP ${response.status}`;
      return { taskId: null, error: `Suno rejected the request: ${detail}` };
    }
    const taskId = data?.data?.taskId ?? null;
    if (!taskId) return { taskId: null, error: "Suno did not return a task id." };
    return { taskId, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { taskId: null, error: `Could not reach Suno (${message}).` };
  }
}

/**
 * Polls a submitted job. A finished task carries two takes of the same brief;
 * both come back so the caller can keep whichever it wants. Never throws.
 */
export async function checkSongJob(taskId: string): Promise<SunoJobState> {
  if (!sunoConfigured()) return { status: "failed", songs: [], error: "SUNO_API_KEY is not set." };
  try {
    const url = `${sunoApiBase()}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.SUNO_API_KEY}` },
      cache: "no-store"
    });
    const data = (await response.json().catch(() => null)) as RecordInfoResponse | null;
    if (!response.ok || (data?.code && data.code !== 200)) {
      return { status: "failed", songs: [], error: `Suno status check failed: ${data?.msg || `HTTP ${response.status}`}` };
    }
    const status = readJobStatus(data?.data?.status);
    if (status === "failed") {
      return { status: "failed", songs: [], error: data?.data?.errorMessage || "Suno could not finish that song." };
    }
    if (status === "pending") return { status: "pending", songs: [] };

    const songs: SunoSong[] = [];
    for (const entry of data?.data?.response?.sunoData ?? []) {
      const audioUrl = entry.audioUrl || entry.sourceAudioUrl || entry.streamAudioUrl;
      if (!audioUrl) continue;
      songs.push({
        id: entry.id || `${taskId}-${songs.length}`,
        title: entry.title?.trim() || "Untitled",
        audioUrl,
        imageUrl: entry.imageUrl,
        tags: entry.tags,
        durationSec: typeof entry.duration === "number" ? entry.duration : undefined
      });
    }
    if (songs.length === 0) {
      return { status: "failed", songs: [], error: "Suno reported success but returned no audio." };
    }
    return { status: "complete", songs };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { status: "failed", songs: [], error: `Could not reach Suno (${message}).` };
  }
}
