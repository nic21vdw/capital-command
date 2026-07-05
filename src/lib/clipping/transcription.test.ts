import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionSegment } from "@/types/domain";

const runYtDlp = vi.fn();
const downloadAudio = vi.fn();
const transcribeMedia = vi.fn();

vi.mock("@/lib/clipping/download", () => ({
  ensureYtDlp: vi.fn(async () => "yt-dlp"),
  runYtDlp: (...args: unknown[]) => runYtDlp(...args),
  downloadAudio: (...args: unknown[]) => downloadAudio(...args)
}));

vi.mock("@/lib/clipping/whisper", () => ({
  transcribeMedia: (...args: unknown[]) => transcribeMedia(...args)
}));

import { fetchSourceCaptions } from "./transcription";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:02.000
Hello world
`;

const whisperSegments: CaptionSegment[] = [
  {
    id: "seg-1",
    start: 0,
    end: 1,
    text: "Transcribed locally",
    words: [{ text: "Transcribed", start: 0, end: 0.5 }, { text: "locally", start: 0.5, end: 1 }],
    enabled: true
  }
];

let destDir: string;

beforeEach(async () => {
  destDir = await mkdtemp(path.join(tmpdir(), "transcription-test-"));
  runYtDlp.mockReset().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
  downloadAudio.mockReset();
  transcribeMedia.mockReset();
});

afterEach(async () => {
  await rm(destDir, { recursive: true, force: true });
});

describe("fetchSourceCaptions", () => {
  it("uses platform captions when the source provides them", async () => {
    runYtDlp.mockImplementation(async () => {
      await writeFile(path.join(destDir, "subs.en.vtt"), VTT, "utf8");
      return { stdout: "", stderr: "", code: 0 };
    });

    const result = await fetchSourceCaptions("https://example.com/v", destDir);
    expect(result.source).toBe("platform");
    expect(result.segments.length).toBeGreaterThan(0);
    expect(transcribeMedia).not.toHaveBeenCalled();
  });

  it("falls back to local transcription when the platform has no captions", async () => {
    const audioPath = path.join(destDir, "source-audio.mp3");
    await writeFile(audioPath, "fake-audio", "utf8");
    transcribeMedia.mockResolvedValue(whisperSegments);

    const result = await fetchSourceCaptions("https://example.com/v", destDir, audioPath);
    expect(result.source).toBe("local");
    expect(result.segments).toEqual(whisperSegments);
    expect(transcribeMedia).toHaveBeenCalledWith(audioPath, destDir);
    expect(downloadAudio).not.toHaveBeenCalled();
  });

  it("re-downloads the audio when the cached file is gone", async () => {
    const downloaded = path.join(destDir, "downloaded.mp3");
    downloadAudio.mockResolvedValue(downloaded);
    transcribeMedia.mockResolvedValue(whisperSegments);

    const result = await fetchSourceCaptions(
      "https://example.com/v",
      destDir,
      path.join(destDir, "missing-audio.mp3")
    );
    expect(result.source).toBe("local");
    expect(downloadAudio).toHaveBeenCalledWith("https://example.com/v", destDir);
    expect(transcribeMedia).toHaveBeenCalledWith(downloaded, destDir);
  });

  it("falls back to local transcription when the platform caption fetch throws", async () => {
    runYtDlp.mockRejectedValue(new Error("network down"));
    const audioPath = path.join(destDir, "source-audio.mp3");
    await writeFile(audioPath, "fake-audio", "utf8");
    transcribeMedia.mockResolvedValue(whisperSegments);

    const result = await fetchSourceCaptions("https://example.com/v", destDir, audioPath);
    expect(result.source).toBe("local");
    expect(result.segments).toEqual(whisperSegments);
  });

  it("throws only when both platform captions and local transcription fail", async () => {
    downloadAudio.mockResolvedValue(path.join(destDir, "downloaded.mp3"));
    transcribeMedia.mockRejectedValue(new Error("No speech was detected in this video."));

    await expect(fetchSourceCaptions("https://example.com/v", destDir)).rejects.toThrow(
      /No speech was detected/
    );
  });
});
