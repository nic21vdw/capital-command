import { describe, expect, it } from "vitest";
import { heuristicSongBrief, parseSongBrief } from "@/lib/music/brief";
import { buildGenerateBody, readJobStatus } from "@/lib/music/suno";

describe("buildGenerateBody", () => {
  it("uses custom mode for an instrumental with a style and title", () => {
    const body = buildGenerateBody(
      { prompt: "warm background loop", style: "lo-fi, keys", title: "Build Log", instrumental: true },
      "V5"
    );
    expect(body).toEqual({
      customMode: true,
      instrumental: true,
      model: "V5",
      prompt: undefined,
      style: "lo-fi, keys",
      title: "Build Log"
    });
  });

  it("falls back to description mode when the style or title is missing", () => {
    const body = buildGenerateBody({ prompt: "  warm background loop  ", instrumental: true }, "V5");
    expect(body.customMode).toBe(false);
    expect(body.prompt).toBe("warm background loop");
    expect(body.style).toBeUndefined();
  });

  it("keeps vocal songs in description mode even with a style and title", () => {
    const body = buildGenerateBody(
      { prompt: "a song about shipping", style: "indie pop", title: "Ship It", instrumental: false },
      "V5"
    );
    expect(body.customMode).toBe(false);
    expect(body.instrumental).toBe(false);
  });
});

describe("readJobStatus", () => {
  it("only treats an exact SUCCESS as finished", () => {
    expect(readJobStatus("SUCCESS")).toBe("complete");
    // Partial states carry SUCCESS in their name but have no downloadable audio yet.
    expect(readJobStatus("TEXT_SUCCESS")).toBe("pending");
    expect(readJobStatus("FIRST_SUCCESS")).toBe("pending");
  });

  it("reads the failure states", () => {
    expect(readJobStatus("CREATE_TASK_FAILED")).toBe("failed");
    expect(readJobStatus("GENERATE_AUDIO_FAILED")).toBe("failed");
    expect(readJobStatus("SENSITIVE_WORD_ERROR")).toBe("failed");
  });

  it("treats anything unknown as still running", () => {
    expect(readJobStatus(undefined)).toBe("pending");
    expect(readJobStatus("PENDING")).toBe("pending");
  });
});

describe("song briefs", () => {
  it("parses a fenced JSON brief", () => {
    const brief = parseSongBrief('```json\n{"title":"Build Log","style":"lo-fi, keys","prompt":"Warm loop."}\n```');
    expect(brief).toEqual({ title: "Build Log", style: "lo-fi, keys", prompt: "Warm loop." });
  });

  it("rejects a brief missing a field", () => {
    expect(parseSongBrief('{"title":"Build Log","style":"lo-fi"}')).toBeNull();
  });

  it("always produces a usable brief offline", () => {
    const brief = heuristicSongBrief("chill beat for a build stream recap");
    expect(brief.title).toBe("Chill Beat For A");
    expect(brief.style).toContain("instrumental");
    expect(brief.prompt).toContain("chill beat for a build stream recap");
  });
});
