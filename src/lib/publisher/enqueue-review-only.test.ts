import { afterEach, expect, it, vi } from "vitest";
import { getJob } from "@/lib/clipping/jobs";
import { maybeAutoEnqueueExport } from "@/lib/publisher/enqueue";
import { publishQueue } from "@/lib/publisher/queue";

vi.mock("@/lib/clipping/jobs", () => ({
  ensureVerticalClipFile: vi.fn(),
  getJob: vi.fn(),
  outputDir: vi.fn()
}));
vi.mock("@/lib/publisher/queue", () => ({ publishQueue: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("keeps an edited draft out of the queue with automatic booking enabled", async () => {
  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
  vi.mocked(getJob).mockResolvedValue({
    id: "draft-job",
    fileName: "Recording",
    sourceUrl: "upload://recording",
    reviewOnly: true,
    status: "done",
    stage: "finished",
    progress: 100,
    notices: [],
    clips: [],
    createdAt: "2026-11-18T12:00:00Z"
  });

  await expect(maybeAutoEnqueueExport({ jobId: "draft-job", exportPath: "draft.mp4" })).resolves.toBeNull();
  expect(getJob).toHaveBeenCalledExactlyOnceWith("draft-job");
  expect(publishQueue).not.toHaveBeenCalled();
});

it("keeps an export out of the queue when its job can no longer be loaded", async () => {
  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
  vi.mocked(getJob).mockResolvedValue(undefined);

  await expect(maybeAutoEnqueueExport({ jobId: "missing-job", exportPath: "draft.mp4" })).resolves.toBeNull();
  expect(getJob).toHaveBeenCalledExactlyOnceWith("missing-job");
  expect(publishQueue).not.toHaveBeenCalled();
});
