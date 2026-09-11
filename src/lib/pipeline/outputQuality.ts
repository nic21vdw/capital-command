/**
 * What the pipeline is asked to output, in picture terms: a resolution ceiling
 * and a frame-rate ceiling. Both default to "source", which means the render
 * keeps whatever the recording already is — the app never upscales a stream
 * and never invents frames, so a numeric choice here can only ever scale DOWN.
 *
 * Leaf module: no imports, no Node, no store. The pipeline page imports it
 * directly, so anything heavier here would pull the server into the client
 * bundle.
 */

export type OutputResolution = "source" | "2160" | "1440" | "1080" | "720";
export type OutputFrameRate = "source" | "60" | "30" | "24";
export type OutputQuality = { resolution: OutputResolution; frameRate: OutputFrameRate };

export const OUTPUT_RESOLUTIONS: { id: OutputResolution; label: string }[] = [
  { id: "source", label: "Source (best)" },
  { id: "2160", label: "4K 2160p" },
  { id: "1440", label: "1440p" },
  { id: "1080", label: "1080p" },
  { id: "720", label: "720p" }
];

export const OUTPUT_FRAME_RATES: { id: OutputFrameRate; label: string }[] = [
  { id: "source", label: "Source (best)" },
  { id: "60", label: "60 fps" },
  { id: "30", label: "30 fps" },
  { id: "24", label: "24 fps" }
];

export const DEFAULT_OUTPUT_QUALITY: OutputQuality = { resolution: "source", frameRate: "source" };

function isResolution(value: unknown): value is OutputResolution {
  return OUTPUT_RESOLUTIONS.some((option) => option.id === value);
}

function isFrameRate(value: unknown): value is OutputFrameRate {
  return OUTPUT_FRAME_RATES.some((option) => option.id === value);
}

/**
 * Reads whatever was stored, posted or typed into a usable choice. Anything
 * unrecognised falls back to "source" per field rather than throwing: this is
 * read from settings written by older builds and from a request body.
 */
export function normalizeOutputQuality(value: unknown): OutputQuality {
  if (!value || typeof value !== "object") return { ...DEFAULT_OUTPUT_QUALITY };
  const raw = value as { resolution?: unknown; frameRate?: unknown };
  const resolution = typeof raw.resolution === "number" ? String(raw.resolution) : raw.resolution;
  const frameRate = typeof raw.frameRate === "number" ? String(raw.frameRate) : raw.frameRate;
  return {
    resolution: isResolution(resolution) ? resolution : DEFAULT_OUTPUT_QUALITY.resolution,
    frameRate: isFrameRate(frameRate) ? frameRate : DEFAULT_OUTPUT_QUALITY.frameRate
  };
}

/** One line for a run header: "Source quality", "1080p · 60 fps", "720p · source fps". */
export function describeOutputQuality(quality: OutputQuality): string {
  const { resolution, frameRate } = normalizeOutputQuality(quality);
  const size = resolution === "source" ? null : `${resolution}p`;
  const rate = frameRate === "source" ? null : `${frameRate} fps`;
  if (!size && !rate) return "Source quality";
  if (size && rate) return `${size} · ${rate}`;
  if (size) return `${size} · source fps`;
  return `Source size · ${rate}`;
}

/** The height ceiling a choice asks for, or null for "whatever the source is". */
export function outputHeightCap(quality: OutputQuality): number | null {
  const { resolution } = normalizeOutputQuality(quality);
  return resolution === "source" ? null : Number(resolution);
}

/** The frame-rate ceiling a choice asks for, or null for "whatever the source is". */
export function outputFrameRateCap(quality: OutputQuality): number | null {
  const { frameRate } = normalizeOutputQuality(quality);
  return frameRate === "source" ? null : Number(frameRate);
}
