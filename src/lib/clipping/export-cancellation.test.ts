import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { makeClipProject } from "./editor";
import { editorPreparationSpec } from "@/lib/integrations/marketing/editor-renderer";
import { cancelExport, startExport } from "./export";
import { runFfmpeg } from "./ffmpeg";

const state = vi.hoisted(() => ({ attach: vi.fn(async () => undefined), enqueue: vi.fn(async () => undefined),
  blockProbe: true, probeEntered: false, releaseProbe: undefined as (() => void) | undefined }));
vi.mock("@/lib/clipping/jobs", async () => {
  const { dataPath } = await import("@/lib/paths");
  return { outputDir: (id: string) => dataPath("clips", "outputs", id), workDir: (id: string) => dataPath("clips", "uploads", id), attachEditedClipRender: state.attach };
});
vi.mock("@/lib/publisher/enqueue", () => ({ maybeAutoEnqueueExport: state.enqueue }));
vi.mock("./ffmpeg", async (original) => {
  const actual = await original<typeof import("./ffmpeg")>();
  return { ...actual, probeDuration: vi.fn(async (...args: Parameters<typeof actual.probeDuration>) => {
    if (state.blockProbe && path.basename(args[0]).startsWith("export-")) {
      state.probeEntered = true;
      await new Promise<void>((resolve) => { state.releaseProbe = resolve; });
    }
    return actual.probeDuration(...args);
  }) };
});

beforeEach(() => { vi.clearAllMocks(); state.blockProbe = true; state.probeEntered = false; state.releaseProbe = undefined; });
async function fixture() {
  const jobId = `synthetic-stop-${randomUUID()}`;
  const project = makeClipProject({ jobId, name: "Synthetic final-probe stop", sourceFile: "source.mp4", sourceUrl: "",
    clipStart: 0, clipEnd: 1.2, sourceFrame: { width: 160, height: 90, fps: 10 } });
  project.compositionMode = "fit"; project.captionsVisible = false;
  project.exportSettings = { ...project.exportSettings, width: 160, height: 90, fps: 10 };
  const source = dataPath("clips", "outputs", jobId, "source.mp4");
  await mkdir(path.dirname(source), { recursive: true });
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=navy:s=160x90:r=10:d=1.2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  return { project, record: startExport(editorPreparationSpec(project)) };
}

it("keeps a stop during the final real output probe from attaching, completing or enqueueing", async () => {
  const { record } = await fixture();
  await vi.waitUntil(() => state.probeEntered, { timeout: 15_000 });
  cancelExport(record.id);
  expect(record.status).toBe("canceled");
  state.releaseProbe!();
  await vi.waitUntil(() => record.status === "done" || state.attach.mock.calls.length > 0 || record.error !== undefined, { timeout: 1500 }).catch(() => undefined);
  expect(record.status).toBe("canceled");
  expect(state.attach).not.toHaveBeenCalled(); expect(state.enqueue).not.toHaveBeenCalled();
}, 20_000);

it("preserves the attached file if legacy cancellation lands inside an already started attachment", async () => {
  state.blockProbe = false;
  let entered = false; let release!: () => void;
  state.attach.mockImplementationOnce(async () => { entered = true; await new Promise<void>((done) => { release = done; }); });
  const { project, record } = await fixture();
  await vi.waitUntil(() => entered, { timeout: 15_000 });
  cancelExport(record.id); expect(record.status).toBe("canceled"); release();
  await vi.waitUntil(() => record.status === "done", { timeout: 2000 });
  expect((await stat(dataPath("clips", "outputs", project.jobId, record.file!))).size).toBeGreaterThan(1024);
  expect(state.attach).toHaveBeenCalledTimes(1); expect(state.enqueue).toHaveBeenCalledTimes(1);
  // Legacy attachment has no atomic cancellation port. Preserve this behavior
  // and its file rather than falsely claim whole-export Stop is repaired.
}, 20_000);
