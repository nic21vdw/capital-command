import { describe, expect, it } from "vitest";
import { heuristicSongBrief, parseSongBrief } from "@/lib/music/brief";
import { describeFalError, queueUrlBase } from "@/lib/music/fal";
import { buildModelInput, getMusicModel, MUSIC_MODELS, readModelAudio, type StudioRequest } from "@/lib/music/models";
import { trackFileName } from "@/lib/music/jobs";

const base: StudioRequest = { modelId: "lyria3-pro", prompt: "warm lo-fi bed", instrumental: true };

function model(id: string) {
  const found = getMusicModel(id);
  if (!found) throw new Error(`missing model ${id}`);
  return found;
}

describe("the registry", () => {
  it("gives every model a unique id and endpoint", () => {
    expect(new Set(MUSIC_MODELS.map((m) => m.id)).size).toBe(MUSIC_MODELS.length);
    expect(new Set(MUSIC_MODELS.map((m) => m.endpointId)).size).toBe(MUSIC_MODELS.length);
  });

  it("keeps every default duration inside its own range", () => {
    for (const entry of MUSIC_MODELS) {
      if (!entry.duration) continue;
      expect(entry.duration.default).toBeGreaterThanOrEqual(entry.duration.min);
      expect(entry.duration.default).toBeLessThanOrEqual(entry.duration.max);
    }
  });
});

describe("buildModelInput", () => {
  it("folds the instrumental toggle into Lyria's prompt, since it has no flag", () => {
    const input = buildModelInput(model("lyria3-pro"), base) as { prompt: string };
    expect(input.prompt).toContain("warm lo-fi bed");
    expect(input.prompt).toContain("Instrumental only, no vocals.");
  });

  it("passes lyrics to Lyria inside the prompt when vocals are wanted", () => {
    const input = buildModelInput(model("lyria3-pro"), {
      ...base,
      modelId: "lyria3-pro",
      instrumental: false,
      lyrics: "shipping at midnight"
    }) as { prompt: string };
    expect(input.prompt).toContain("Lyrics:\nshipping at midnight");
    expect(input.prompt).not.toContain("Instrumental only");
  });

  it("uses ACE-Step's [inst] marker for an instrumental", () => {
    const input = buildModelInput(model("ace-step"), { ...base, modelId: "ace-step" }) as {
      tags: string;
      lyrics: string;
      duration: number;
    };
    expect(input.tags).toBe("warm lo-fi bed");
    expect(input.lyrics).toBe("[inst]");
    expect(input.duration).toBe(60);
  });

  it("clamps a duration to the selected model's range", () => {
    const tooLong = buildModelInput(model("cassette"), { ...base, modelId: "cassette", durationSec: 900 }) as {
      duration: number;
    };
    const tooShort = buildModelInput(model("ace-step"), { ...base, modelId: "ace-step", durationSec: 1 }) as {
      duration: number;
    };
    expect(tooLong.duration).toBe(180);
    expect(tooShort.duration).toBe(5);
  });

  it("lets MiniMax write the lyrics when a vocal track has none", () => {
    const input = buildModelInput(model("minimax-2-6"), {
      ...base,
      modelId: "minimax-2-6",
      instrumental: false
    }) as { is_instrumental: boolean; lyrics_optimizer: boolean };
    expect(input.is_instrumental).toBe(false);
    expect(input.lyrics_optimizer).toBe(true);
  });

  it("pads a MiniMax prompt up to its 10-character minimum", () => {
    const input = buildModelInput(model("minimax-2-6"), { ...base, modelId: "minimax-2-6", prompt: "lofi" }) as {
      prompt: string;
    };
    expect(input.prompt.length).toBeGreaterThanOrEqual(10);
  });

  it("ignores a vocal request on an instrumental-only model", () => {
    const input = buildModelInput(model("cassette"), {
      ...base,
      modelId: "cassette",
      instrumental: false,
      lyrics: "la la la"
    });
    expect(JSON.stringify(input)).not.toContain("la la la");
  });

  it("caps sonilo's takes at three", () => {
    const input = buildModelInput(model("sonilo"), { ...base, modelId: "sonilo", samples: 9 }) as {
      num_samples: number;
    };
    expect(input.num_samples).toBe(3);
  });
});

describe("readModelAudio", () => {
  it("reads cassette's audio_file key", () => {
    const takes = readModelAudio(model("cassette"), { audio_file: { url: "https://x/y.wav" } });
    expect(takes).toEqual([{ url: "https://x/y.wav", contentType: undefined, fileName: undefined }]);
  });

  it("reads every sonilo take", () => {
    const takes = readModelAudio(model("sonilo"), {
      audio: { url: "https://x/1.m4a" },
      audios: [{ url: "https://x/1.m4a" }, { url: "https://x/2.m4a" }]
    });
    expect(takes.map((take) => take.url)).toEqual(["https://x/1.m4a", "https://x/2.m4a"]);
  });

  it("falls back to the single audio key when a take list is missing", () => {
    expect(readModelAudio(model("lyria3-pro"), { audio: { url: "https://x/1.mp3" } })).toHaveLength(1);
    expect(readModelAudio(model("lyria3-pro"), {})).toEqual([]);
  });
});

describe("queueUrlBase", () => {
  it("drops a variant sub-path, because fal keys the queue on owner/app", () => {
    // Polling fal-ai/lyria3/pro/requests/{id} answers 405 — the published
    // OpenAPI schema documents the submit path for all three routes.
    expect(queueUrlBase("fal-ai/lyria3/pro")).toBe("fal-ai/lyria3");
    expect(queueUrlBase("fal-ai/minimax-music/v2.6")).toBe("fal-ai/minimax-music");
    expect(queueUrlBase("sonilo/v1.1/text-to-music")).toBe("sonilo/v1.1");
  });

  it("leaves a two-segment endpoint alone", () => {
    expect(queueUrlBase("fal-ai/ace-step")).toBe("fal-ai/ace-step");
    expect(queueUrlBase("cassetteai/music-generator")).toBe("cassetteai/music-generator");
  });
});

describe("describeFalError", () => {
  it("flattens fal's per-field validation errors", () => {
    const message = describeFalError({ detail: [{ loc: ["body", "duration"], msg: "must be <= 180" }] }, 422);
    expect(message).toBe("duration: must be <= 180");
  });

  it("falls back to the status code when there is no detail", () => {
    expect(describeFalError(null, 503)).toBe("HTTP 503");
  });
});

describe("track file names", () => {
  it("numbers extra takes and keeps the extension", () => {
    expect(trackFileName("Build Log", 0, ".mp3")).toBe("Build Log.mp3");
    expect(trackFileName("Build Log", 1, ".wav")).toBe("Build Log (take 2).wav");
  });

  it("strips characters a filesystem would reject", () => {
    expect(trackFileName('night/drive: "one"', 0, ".mp3")).toBe("nightdrive one.mp3");
  });
});

describe("song briefs", () => {
  it("parses a fenced JSON brief", () => {
    const brief = parseSongBrief('```json\n{"title":"Build Log","style":"lofi, keys","prompt":"Warm loop."}\n```');
    expect(brief).toEqual({ title: "Build Log", style: "lofi, keys", prompt: "Warm loop." });
  });

  it("always produces a usable brief offline", () => {
    const brief = heuristicSongBrief("chill beat for a build stream recap");
    expect(brief.title).toBe("Chill Beat For A");
    expect(brief.prompt).toContain("chill beat for a build stream recap");
  });
});
