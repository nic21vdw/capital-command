import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captionStyleForPreset } from "@/lib/clipping/editor";
import { startExport, type ExportSpec } from "@/lib/clipping/export";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { createJobFromUpload, getJob, outputDir, retryMissingRenders, workDir } from "@/lib/clipping/jobs";
import { renderCaptionedVertical, renderSourceClip } from "@/lib/clipping/render";
import { diskFullMessage, DiskSpaceError } from "@/lib/disk/space";
import { dataPath } from "@/lib/paths";

vi.mock("@/lib/clipping/ffmpeg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clipping/ffmpeg")>();
  return {
    ...actual,
    runFfmpeg: vi.fn(),
    hasAudioStream: vi.fn(async () => true),
    probeDuration: vi.fn(async () => 20),
    probeDimensions: vi.fn(async () => ({ width: 1280, height: 720 })),
    probeVideoStream: vi.fn(async () => ({ width: 1280, height: 720, durationSec: 30, fps: 30 }))
  };
});

vi.mock("@/lib/clipping/render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clipping/render")>();
  return {
    ...actual,
    renderPreviewAssets: vi.fn(async (_input: string, preview: string, poster: string) => {
      await writeFile(preview, "preview");
      await writeFile(poster, "poster");
    }),
    renderSourceClip: vi.fn(async (_input: string, output: string) => {
      await writeFile(output, "master");
    }),
    renderCaptionedVertical: vi.fn(async (_input: string, output: string) => {
      await writeFile(output, "ready");
    })
  };
});

vi.mock("@/lib/clipping/thumbnails", () => ({ ensureClipThumbnail: vi.fn(async () => undefined) }));
vi.mock("@/lib/publisher/enqueue", () => ({ maybeAutoEnqueueExport: vi.fn() }));

const SOURCE_ID = "src-clip-1";
const JOB_IDS = ["ok", "fails", "full", "guarded", "editor"];

function jobFixture(id: string) {
  return {
    id,
    fileName: "stream.mp4",
    clipCount: 2,
    autoFrame: false,
    sourceUrl: `upload://${SOURCE_ID}`,
    sourceId: SOURCE_ID,
    status: "error",
    stage: "rendering",
    progress: 50,
    notices: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    sourceCaptions: [],
    clips: [
      {
        id: `${id}-c1`,
        start: 5,
        end: 25,
        score: 1,
        breakdown: { hook: 1, pacing: 1, standalone: 1, intensity: 1 },
        rationale: "test",
        title: "Clip one"
      }
    ]
  };
}

beforeAll(async () => {
  const sourceDir = dataPath("clips", "sources", SOURCE_ID);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    path.join(sourceDir, "meta.json"),
    JSON.stringify({
      id: SOURCE_ID,
      fileName: "stream.mp4",
      storedName: "video.mp4",
      mime: "video/mp4",
      sizeBytes: 5,
      durationSec: 120,
      width: 1280,
      height: 720,
      hasAudio: true,
      createdAt: "2026-10-01T00:00:00.000Z"
    })
  );
  await writeFile(path.join(sourceDir, "video.mp4"), "video");
  await writeFile(dataPath("clips", "jobs.json"), JSON.stringify(JOB_IDS.map(jobFixture)));
  for (const id of JOB_IDS) {
    await mkdir(workDir(id), { recursive: true });
    await mkdir(outputDir(id), { recursive: true });
  }
});

const ffmpeg = vi.mocked(runFfmpeg);
const seenInWorkDir = new Set<string>();

function fakeCut(jobId: string) {
  ffmpeg.mockImplementation(async (args) => {
    for (const name of await readdir(workDir(jobId))) seenInWorkDir.add(name);
    await writeFile(args.at(-1) as string, "section");
    return { stdout: "", stderr: "", code: 0 };
  });
}

async function renderFinished(jobId: string) {
  await retryMissingRenders(jobId);
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const job = await getJob(jobId);
    if (job && job.status !== "processing") return job;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("The job never settled.");
}

async function scratchFiles(jobId: string) {
  return (await readdir(workDir(jobId))).filter((name) => /^(seg-|caps-|export-)/.test(name));
}

beforeEach(() => {
  seenInWorkDir.clear();
  ffmpeg.mockReset();
  vi.mocked(renderSourceClip).mockClear();
  vi.mocked(renderCaptionedVertical).mockClear();
  vi.stubEnv("RENDER_MIN_FREE_GB", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clip render scratch files", () => {
  it("removes the cut section and the caption script after a successful render", async () => {
    fakeCut("ok");
    vi.mocked(renderCaptionedVertical).mockImplementationOnce(async (_input, output) => {
      for (const name of await readdir(workDir("ok"))) seenInWorkDir.add(name);
      await writeFile(output as string, "ready");
    });

    const job = await renderFinished("ok");

    expect(job.status).toBe("done");
    expect(job.clips[0].downloadFile).toBe("clip-01-ready.mp4");
    expect([...seenInWorkDir].some((name) => name.startsWith("seg-"))).toBe(true);
    expect([...seenInWorkDir].some((name) => name.startsWith("caps-"))).toBe(true);
    expect(await scratchFiles("ok")).toEqual([]);
  });

  it("removes them when the render fails", async () => {
    fakeCut("fails");
    vi.mocked(renderSourceClip).mockRejectedValueOnce(new Error("ffmpeg exited with code 1: Invalid data found"));

    const job = await renderFinished("fails");

    expect(job.notices.join(" ")).toContain("Invalid data found");
    expect(await scratchFiles("fails")).toEqual([]);
  });

  it("removes them and reports a full disk plainly when the disk fills mid-render", async () => {
    fakeCut("full");
    vi.mocked(renderSourceClip).mockRejectedValueOnce(
      Object.assign(new Error("ffmpeg exited with code 1: No space left on device"), { code: "ENOSPC" })
    );

    const job = await renderFinished("full");

    expect(job.notices.join(" ")).toContain(diskFullMessage());
    expect(await scratchFiles("full")).toEqual([]);
  });
});

describe("clip editor export scratch folder", () => {
  function editorSpec(): ExportSpec {
    return {
      jobId: "editor",
      sourceFile: "clip-01.mp4",
      baseDurationSec: 20,
      trimStart: 0,
      trimEnd: 20,
      compositionMode: "center-blur",
      reframe: { scale: 1, offsetX: 0, offsetY: 0 },
      captions: [{ id: "c", start: 1, end: 3, text: "hello there", words: [], enabled: true }],
      captionStyle: captionStyleForPreset(),
      captionsVisible: true,
      highlightCurrentWord: false,
      overlays: [],
      audio: { clipVolume: 1, fadeIn: 0, fadeOut: 0, musicVolume: 0.3 },
      settings: {
        preset: "shorts",
        width: 1080,
        height: 1920,
        fps: 30,
        quality: "high",
        format: "mp4",
        burnCaptions: true,
        separateSubtitle: false,
        watermark: false,
        filename: "clip"
      } as ExportSpec["settings"]
    };
  }

  async function exportSettled(record: ReturnType<typeof startExport>) {
    const { getExport } = await import("@/lib/clipping/export");
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const current = getExport(record.id);
      if (current && current.status !== "processing") return current;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error("The export never settled.");
  }

  async function exportFolders() {
    return (await readdir(workDir("editor"))).filter((name) => name.startsWith("export-"));
  }

  it.each([
    { name: "opaque H.264 crop", codec: "h264 (High), yuv420p", mode: "crop-fill", blur: false },
    { name: "alpha-capable crop", codec: "vp9, yuva420p", mode: "crop-fill", blur: true },
    { name: "unknown input crop", codec: "", mode: "crop-fill", blur: true },
    { name: "visible center blur", codec: "h264 (High), yuv420p", mode: "center-blur", blur: true }
  ] as const)("preserves composition for $name", async ({ codec, mode, blur }) => {
    const graphs: string[] = [];
    ffmpeg.mockImplementation(async (args) => {
      if (args.includes("-hide_banner")) {
        return {
          stdout: "",
          stderr: codec ? `  Stream #0:0: Video: ${codec}, 1920x1080\n  Stream #0:1: Audio: aac, 48000 Hz` : "",
          code: 1
        };
      }
      const filterIndex = args.indexOf("-filter_complex");
      if (filterIndex >= 0) graphs.push(args[filterIndex + 1]);
      await writeFile(args.at(-1) as string, Buffer.alloc(4096));
      return { stdout: "", stderr: "", code: 0 };
    });

    const done = await exportSettled(startExport({ ...editorSpec(), compositionMode: mode }));

    expect(done.status).toBe("done");
    expect(graphs).toHaveLength(1);
    expect(graphs[0].includes("boxblur=24:4")).toBe(blur);
    expect(graphs[0]).toContain("split=2[__bg][__fg]");
    expect(graphs[0]).toContain("[__bgb][__fgs]overlay=");
    if (codec) expect(graphs[0]).toContain("[0:a]"); // Reusing the probe retains audio.
  });

  it("deletes its subtitle and overlay scratch folder after a successful export", async () => {
    ffmpeg.mockImplementation(async (args) => {
      for (const name of await readdir(workDir("editor"))) seenInWorkDir.add(name);
      await writeFile(args.at(-1) as string, Buffer.alloc(4096));
      return { stdout: "", stderr: "", code: 0 };
    });

    const done = await exportSettled(startExport(editorSpec()));

    expect(done.status).toBe("done");
    expect([...seenInWorkDir].some((name) => name.startsWith("export-"))).toBe(true);
    expect(await exportFolders()).toEqual([]);
    await expect(stat(path.join(outputDir("editor"), done.file as string))).resolves.toBeTruthy();
  });

  it("deletes it when the export fails, and reports a full disk plainly", async () => {
    ffmpeg.mockRejectedValue(Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }));

    const failed = await exportSettled(startExport(editorSpec()));

    expect(failed.status).toBe("error");
    expect(failed.error).toBe(diskFullMessage());
    expect(await exportFolders()).toEqual([]);
  });
});

describe("clip free-space guard", () => {
  it("refuses to start a clip job from an upload when free space is under RENDER_MIN_FREE_GB", async () => {
    vi.stubEnv("RENDER_MIN_FREE_GB", "999999999");

    await expect(createJobFromUpload(SOURCE_ID, undefined)).rejects.toBeInstanceOf(DiskSpaceError);
  });

  it("refuses to re-render a job's missing clips", async () => {
    vi.stubEnv("RENDER_MIN_FREE_GB", "999999999");
    fakeCut("guarded");

    await expect(retryMissingRenders("guarded")).rejects.toBeInstanceOf(DiskSpaceError);

    expect(ffmpeg).not.toHaveBeenCalled();
    expect((await getJob("guarded"))?.status).toBe("error");
  });
});
