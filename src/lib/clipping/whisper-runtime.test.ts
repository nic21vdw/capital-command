import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  samples: [] as number[],
  messages: [] as number[],
  workers: [] as EventEmitter[],
  hold: false,
  failDecode: false,
  exitBeforeReady: false,
  exitDuringDecode: false,
  pipelineLoads: 0,
  fallbackCalls: 0
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  readFile: vi.fn(async () => {
    const samples = state.samples.shift();
    if (samples === undefined) throw new Error("Unexpected PCM decode");
    return Buffer.alloc(samples * 4);
  })
}));

vi.mock("@/lib/clipping/ffmpeg", () => ({
  probeDuration: vi.fn(async () => 2),
  runFfmpeg: vi.fn(async () => {
    if (state.failDecode) throw new Error("decode failed");
    if (state.exitDuringDecode) {
      state.exitDuringDecode = false;
      state.workers.at(-1)!.emit("exit", 1);
    }
    return { stdout: "", stderr: "" };
  })
}));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      constructor() {
        super();
        state.workers.push(this);
        queueMicrotask(() => state.exitBeforeReady
          ? this.emit("exit", 1)
          : this.emit("message", { ready: true }));
      }
      unref() {}
      terminate() { return Promise.resolve(0); }
      postMessage(message: { id: number; pcm: ArrayBuffer }, transfer: ArrayBuffer[]) {
        state.messages.push(message.id);
        // Match native transfer semantics without loading ONNX or decoding media.
        structuredClone(message, { transfer });
        if (!state.hold) queueMicrotask(() => this.emit("message", {
          id: message.id, chunks: [{ text: " word", timestamp: [0, 0.5] }]
        }));
      }
    }
  };
});

vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: vi.fn(async () => {
    state.pipelineLoads += 1;
    return async () => {
      state.fallbackCalls += 1;
      return { text: "word", chunks: [{ text: " word", timestamp: [0, 0.5] }] };
    };
  })
}));

import { readFile, rm } from "node:fs/promises";
import { probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { transcribeMedia } from "./whisper";

type WhisperTestGlobal = typeof globalThis & {
  __whisperRunner?: unknown;
  __whisperModelId?: string;
  __whisperWindowTail?: Promise<void>;
};
const globals = globalThis as WhisperTestGlobal;
const complete = (id: number) => state.workers[0].emit("message", {
  id, chunks: [{ text: " word", timestamp: [0, 0.5] }]
});

beforeEach(() => {
  vi.clearAllMocks();
  state.samples = [32000];
  state.messages = [];
  state.workers = [];
  state.hold = false;
  state.failDecode = false;
  state.exitBeforeReady = false;
  state.exitDuringDecode = false;
  state.pipelineLoads = 0;
  state.fallbackCalls = 0;
  globals.__whisperRunner = undefined;
  globals.__whisperModelId = undefined;
  globals.__whisperWindowTail = undefined;
  vi.mocked(probeDuration).mockResolvedValue(2);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globals.__whisperRunner;
  delete globals.__whisperModelId;
  delete globals.__whisperWindowTail;
});

describe("transcription resource bounds", () => {
  it("falls back once when a worker exits before ready and releases queued callers", async () => {
    state.exitBeforeReady = true;
    state.samples = [32000, 32000];
    const results = await Promise.all([
      transcribeMedia("first.mp4", "work"),
      transcribeMedia("second.mp4", "work")
    ]);
    expect(results.every((segments) => segments.length === 1)).toBe(true);
    expect(state.workers).toHaveLength(1);
    expect(state.pipelineLoads).toBe(1);
    expect(state.fallbackCalls).toBe(2);
    expect(globals.__whisperRunner).toBeDefined();
    expect(globals.__whisperWindowTail).toBeUndefined();
    // Permanent handlers remain; temporary startup handlers were removed.
    expect(state.workers[0].listenerCount("message")).toBe(1);
    expect(state.workers[0].listenerCount("error")).toBe(1);
    expect(state.workers[0].listenerCount("exit")).toBe(1);
  });

  it("ignores an old worker exit after its replacement of the same model starts", async () => {
    state.samples = [32000, 32000, 32000];
    await transcribeMedia("first.mp4", "work");
    const oldWorker = state.workers[0];
    oldWorker.emit("error", new Error("worker failed"));
    await transcribeMedia("second.mp4", "work");
    const replacement = globals.__whisperRunner;
    oldWorker.emit("exit", 1);
    expect(globals.__whisperRunner).toBe(replacement);
    await transcribeMedia("third.mp4", "work");
    expect(state.workers).toHaveLength(2);
    expect(state.pipelineLoads).toBe(0);
  });

  it("releases a window when the worker stops during its PCM decode", async () => {
    state.samples = [32000, 32000];
    state.exitDuringDecode = true;
    const first = transcribeMedia("first.mp4", "work");
    const failure = expect(first).rejects.toThrow("worker stopped");
    const second = transcribeMedia("second.mp4", "work");
    await failure;
    await expect(second).resolves.toHaveLength(1);
    expect(state.workers).toHaveLength(2);
    expect(globals.__whisperWindowTail).toBeUndefined();
  });

  it("keeps failed-probe decodes bounded and offsets later windows until EOF", async () => {
    vi.mocked(probeDuration).mockRejectedValue(new Error("bad header"));
    state.samples = [600 * 16000, 2 * 16000];
    const segments = await transcribeMedia("recording.mp4", "work");

    expect(vi.mocked(runFfmpeg).mock.calls.map(([args]) => args)).toEqual([
      expect.arrayContaining(["-t", "600.000"]),
      expect.arrayContaining(["-ss", "600.000", "-t", "600.000"])
    ]);
    expect(segments.map((segment) => segment.start)).toEqual([0, 600]);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(rm).toHaveBeenCalledTimes(2);
  });

  it("honors an opening-only cap when the duration probe fails", async () => {
    vi.mocked(probeDuration).mockRejectedValue(new Error("bad header"));
    await transcribeMedia("recording.mp4", "work", { maxSeconds: 60 });
    expect(runFfmpeg).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runFfmpeg).mock.calls[0][0]).toEqual(expect.arrayContaining(["-t", "60.000"]));
  });

  it("queues before decode so a waiting request retains no PCM", async () => {
    state.samples = [32000, 32000];
    state.hold = true;
    const first = transcribeMedia("first.mp4", "work");
    await vi.waitFor(() => expect(state.messages).toHaveLength(1));
    const second = transcribeMedia("second.mp4", "work");
    await vi.waitFor(() => expect(probeDuration).toHaveBeenCalledTimes(2));
    expect(runFfmpeg).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledTimes(1);

    complete(1);
    await first;
    await vi.waitFor(() => expect(state.messages).toHaveLength(2));
    complete(2);
    await second;
    expect(state.workers).toHaveLength(1);
    expect(runFfmpeg).toHaveBeenCalledTimes(2);
  });

  it("lets a waiting short job run between windows of a long job", async () => {
    vi.mocked(probeDuration).mockImplementation(async (mediaPath) => mediaPath === "long.mp4" ? 602 : 2);
    state.samples = [600 * 16000, 32000, 32000];
    state.hold = true;
    const long = transcribeMedia("long.mp4", "work");
    await vi.waitFor(() => expect(state.messages).toHaveLength(1));
    const short = transcribeMedia("short.mp4", "work");
    await vi.waitFor(() => expect(probeDuration).toHaveBeenCalledTimes(2));

    complete(1);
    await vi.waitFor(() => expect(state.messages).toHaveLength(2));
    expect(vi.mocked(runFfmpeg).mock.calls[1][0]).toEqual(expect.arrayContaining(["-i", "short.mp4"]));
    complete(2);
    await short;
    await vi.waitFor(() => expect(state.messages).toHaveLength(3));
    expect(vi.mocked(runFfmpeg).mock.calls[2][0]).toEqual(expect.arrayContaining([
      "-ss", "600.000", "-i", "long.mp4", "-t", "2.000"
    ]));
    complete(3);
    expect((await long).map((segment) => segment.start)).toEqual([0, 600]);
  });

  it("releases admission after a failed decode and cleans up its temporary file", async () => {
    state.failDecode = true;
    await expect(transcribeMedia("broken.mp4", "work")).rejects.toThrow("decode failed");
    expect(rm).toHaveBeenCalledTimes(1);
    state.failDecode = false;
    await expect(transcribeMedia("working.mp4", "work")).resolves.toHaveLength(1);
    expect(globals.__whisperWindowTail).toBeUndefined();
  });

  it("releases admission after failed worker inference", async () => {
    state.samples = [32000, 32000];
    state.hold = true;
    const first = transcribeMedia("first.mp4", "work");
    const failure = expect(first).rejects.toThrow("inference failed");
    await vi.waitFor(() => expect(state.messages).toHaveLength(1));
    state.workers[0].emit("message", { id: 1, error: "inference failed" });
    await failure;
    state.hold = false;
    await expect(transcribeMedia("second.mp4", "work")).resolves.toHaveLength(1);
  });

  it("uses distinct PCM paths even when the clock does not advance", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    state.samples = [32000, 32000];
    await transcribeMedia("first.mp4", "work");
    await transcribeMedia("second.mp4", "work");
    const paths = vi.mocked(runFfmpeg).mock.calls.map(([args]) => args[args.length - 1]);
    expect(new Set(paths).size).toBe(2);
    expect(paths.every((pcmPath) => /whisper-[0-9a-f-]{36}\.pcm$/.test(pcmPath))).toBe(true);
  });
});
