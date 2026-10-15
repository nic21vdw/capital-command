import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderCanceledError, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { diskFullMessage, DiskSpaceError } from "@/lib/disk/space";
import { cancelLongformExport, startLongformExport } from "@/lib/longform/render";
import { planCaptions, planHook } from "@/lib/longform/plan";
import * as store from "@/lib/longform/store";
import { dataPath } from "@/lib/paths";

vi.mock("@/lib/clipping/ffmpeg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clipping/ffmpeg")>();
  return {
    ...actual,
    runFfmpeg: vi.fn(),
    probeVideoStream: vi.fn(async () => ({ width: 1280, height: 720, durationSec: 120, fps: 30 }))
  };
});

vi.mock("@/lib/title/finalize", () => ({
  finalizeTitle: async ({ baseTitle }: { baseTitle: string }) => ({ title: baseTitle, emojiUsed: false })
}));

vi.mock("@/lib/longform/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/longform/store")>();
  return { ...actual, updateProject: vi.fn(actual.updateProject) };
});

const SOURCE_ID = "src-disk-1";
const PROJECT_IDS = ["ok", "late-failure", "enospc", "stopped", "guarded", "unsavable", "seeked", "unseeked"];

function spokenTranscript() {
  const words = ["hello", "there", "friend"].map((text, index) => ({ text, start: 70 + index, end: 71 + index }));
  return [{ id: "t-1", start: 70, end: 73, text: "hello there friend", words, enabled: true }];
}

function projectFixture(id: string) {
  const hook = planHook([], 120);
  return {
    id,
    name: `Disk test ${id}`,
    sourceId: SOURCE_ID,
    fileName: "stream.mp4",
    status: "ready",
    stage: "ready",
    progress: 100,
    notices: [],
    durationSec: 120,
    width: 1280,
    height: 720,
    hasAudio: true,
    transcript: [],
    silences: [],
    segments: [
      { id: "s1", start: 0, end: 60, kind: "speech", enabled: true },
      { id: "s2", start: 60, end: 120, kind: "speech", enabled: true }
    ],
    hook,
    captions: planCaptions(spokenTranscript()),
    overlays: [],
    music: { enabled: false, clips: [], videoVolume: 1, masterVolume: 1 },
    layout: "wide",
    pace: "balanced",
    exports: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z"
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
  await mkdir(dataPath("longform"), { recursive: true });
  await writeFile(dataPath("longform", "projects.json"), JSON.stringify(PROJECT_IDS.map(projectFixture)));
  for (const id of PROJECT_IDS) {
    await mkdir(store.projectWorkDir(id), { recursive: true });
    await mkdir(store.projectOutputDir(id), { recursive: true });
  }
});

const ffmpeg = vi.mocked(runFfmpeg);
const seenInWorkDir = new Set<string>();
const seenBodyGraphs = new Map<string, string>();

function fakeFfmpeg(options: { failOnCall?: number; error?: Error; hangOnCall?: number } = {}, projectId: string) {
  let call = 0;
  ffmpeg.mockImplementation(async (args, runOptions) => {
    call += 1;
    const scriptIndex = args.indexOf("-filter_complex_script");
    if (scriptIndex >= 0) seenBodyGraphs.set(projectId, await readFile(args[scriptIndex + 1], "utf8"));
    for (const name of await readdir(store.projectWorkDir(projectId))) seenInWorkDir.add(name);
    if (options.hangOnCall === call) {
      await new Promise<void>((_, reject) => {
        runOptions?.signal?.addEventListener("abort", () => reject(new RenderCanceledError()), { once: true });
      });
    }
    if (options.failOnCall === call) throw options.error ?? new Error("ffmpeg exited with code 1: Invalid data found");
    await writeFile(args.at(-1) as string, "frames");
    return { stdout: "", stderr: "", code: 0 };
  });
}

async function settled(projectId: string, recordId: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const project = await store.getProject(projectId);
    const record = project?.exports.find((item) => item.id === recordId);
    if (record && record.status !== "processing") return record;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("The export never settled.");
}

async function exportIntermediates(projectId: string) {
  return (await readdir(store.projectWorkDir(projectId))).filter((name) => name.startsWith("export-"));
}

async function run(projectId: string) {
  const project = await store.getProject(projectId);
  const record = await startLongformExport(project!);
  return settled(projectId, record.id);
}

beforeEach(() => {
  seenInWorkDir.clear();
  seenBodyGraphs.clear();
  ffmpeg.mockReset();
  vi.mocked(store.updateProject).mockClear();
  vi.stubEnv("RENDER_MIN_FREE_GB", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("long-form export intermediates", () => {
  it("leaves only the finished video behind after a successful export", async () => {
    fakeFfmpeg({}, "ok");

    const record = await run("ok");

    expect(record.status).toBe("done");
    const intermediates = [...seenInWorkDir].filter((name) => name.startsWith("export-"));
    for (const kind of ["hook.mp4", "hook.ass", "body.mp4", "body-filter.txt", "concat.txt", "merged.mp4", "captions.ass", "burned.mp4"]) {
      expect(intermediates.some((name) => name.endsWith(`-${kind}`))).toBe(true);
    }
    expect(await exportIntermediates("ok")).toEqual([]);
    expect(await readdir(store.projectOutputDir("ok"))).toEqual([record.file]);
  });

  it("deletes the intermediates when a late stage fails", async () => {
    fakeFfmpeg({ failOnCall: 5 }, "late-failure");

    const record = await run("late-failure");

    expect(record.status).toBe("error");
    expect(record.error).toContain("Invalid data found");
    expect([...seenInWorkDir].some((name) => name.endsWith("-merged.mp4") || name.endsWith("-body.mp4"))).toBe(true);
    expect(await exportIntermediates("late-failure")).toEqual([]);
  });

  it("deletes the intermediates when the user stops the render", async () => {
    fakeFfmpeg({ hangOnCall: 2 }, "stopped");
    const project = await store.getProject("stopped");
    const started = await startLongformExport(project!);
    for (let attempt = 0; attempt < 200 && ffmpeg.mock.calls.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await cancelLongformExport("stopped", started.id);
    const record = await settled("stopped", started.id);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(record.status).toBe("canceled");
    expect(await exportIntermediates("stopped")).toEqual([]);
  });

  it("fails an export cleanly when the disk fills mid-render, with the same message as the guard", async () => {
    const full = Object.assign(new Error("ffmpeg exited with code 1: av_interleaved_write_frame(): No space left on device"), {
      code: "ENOSPC"
    });
    fakeFfmpeg({ failOnCall: 2, error: full }, "enospc");

    const record = await run("enospc");

    expect(record.status).toBe("error");
    expect(record.error).toBe(diskFullMessage());
    expect(await exportIntermediates("enospc")).toEqual([]);
  });

  it("does not leave an unhandled rejection when even recording the failure hits a full disk", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      fakeFfmpeg({ failOnCall: 2, error: new Error("ffmpeg exited with code 1: Invalid data found") }, "unsavable");
      const real = vi.mocked(store.updateProject).getMockImplementation()!;
      vi.mocked(store.updateProject).mockImplementation(async (id, patch) => {
        const exportsPatch = (patch as { exports?: Array<{ status: string }> }).exports;
        if (exportsPatch?.[0]?.status === "error") {
          throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
        }
        return real(id, patch);
      });

      const project = await store.getProject("unsavable");
      await startLongformExport(project!);
      for (let attempt = 0; attempt < 100 && ffmpeg.mock.calls.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(unhandled).not.toHaveBeenCalled();
      expect(await exportIntermediates("unsavable")).toEqual([]);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});


describe("long-form body input seeking", () => {
  it.each([
    { id: "seeked", start: 7200.125, end: 7212.999, input: ["-ss", "7140.000", "-t", "73.999"], selector: "between(t,60.125,72.999)" },
    { id: "unseeked", start: 30, end: 120, input: ["-t", "121.000"], selector: "between(t,30.000,120.000)" }
  ])("uses the same $id body window for picture and audio", async ({ id, start, end, input, selector }) => {
    const project = (await store.getProject(id))!;
    await store.updateProject(id, {
      durationSec: Math.max(120, end),
      hook: { ...project.hook, enabled: false },
      captions: { ...project.captions!, enabled: false },
      segments: [{ id: "kept", start, end, kind: "speech", enabled: true }]
    });
    fakeFfmpeg({}, id);

    const record = await run(id);

    expect(record.status).toBe("done");
    const bodyCall = ffmpeg.mock.calls.find(([args]) => args.includes("-filter_complex_script"))!;
    expect(bodyCall[0].slice(0, bodyCall[0].indexOf("-i"))).toEqual(["-y", ...input]);
    const graph = seenBodyGraphs.get(id)!;
    expect(graph).toContain("[0:v]select='" + selector + "',setpts=N/FRAME_RATE/TB");
    expect(graph).toContain("[0:a]aselect='" + selector + "',asetpts=N/SR/TB[aout]");
    expect(graph).toContain("fps=30");
    expect(await exportIntermediates(id)).toEqual([]);
  });
});

describe("long-form free-space guard", () => {
  it("refuses to start a render when free space is under RENDER_MIN_FREE_GB", async () => {
    vi.stubEnv("RENDER_MIN_FREE_GB", "999999999");
    fakeFfmpeg({}, "guarded");
    const project = await store.getProject("guarded");

    await expect(startLongformExport(project!)).rejects.toBeInstanceOf(DiskSpaceError);

    expect(ffmpeg).not.toHaveBeenCalled();
    expect((await store.getProject("guarded"))?.exports).toEqual([]);
  });
});
