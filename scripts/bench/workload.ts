import childProcess from "node:child_process";
import { link, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const spawned: Record<string, number> = {};

function countSpawns() {
  const original = childProcess.spawn;
  childProcess.spawn = ((command: string, ...rest: unknown[]) => {
    const name = path.basename(String(command)).replace(/\.exe$/i, "");
    spawned[name] = (spawned[name] ?? 0) + 1;
    return (original as (...args: unknown[]) => unknown)(command, ...rest);
  }) as typeof childProcess.spawn;
}

type Result = Record<string, unknown> & { outputs?: string[] };

const SYNTHETIC_WORDS = [
  "so", "today", "we", "are", "building", "an", "AI", "agent", "with", "Claude",
  "and", "the", "vibe", "coding", "workflow", "keeps", "breaking", "until", "the", "fix",
  "lands", "in", "the", "SaaS", "dashboard", "right", "here"
];

function installSyntheticTranscriber() {
  const g = globalThis as typeof globalThis & { __whisperRunner?: Promise<unknown>; __whisperModelId?: string };
  g.__whisperModelId = process.env.CLIPS_WHISPER_MODEL?.trim() || "Xenova/whisper-base.en";
  g.__whisperRunner = Promise.resolve(async (audio: Float32Array) => {
    const seconds = audio.length / 16000;
    const chunks: Array<{ text: string; timestamp: [number, number] }> = [];
    for (let index = 0; index * 0.45 + 0.4 < seconds; index += 1) {
      const start = Number((index * 0.45).toFixed(2));
      const word = SYNTHETIC_WORDS[index % SYNTHETIC_WORDS.length];
      const text = index % 14 === 13 ? `${word}.` : word;
      chunks.push({ text: ` ${text}`, timestamp: [start, Number((start + 0.4).toFixed(2))] });
    }
    return chunks;
  });
}

async function waitFor<T>(read: () => Promise<T> | T, done: (value: T) => boolean, label: string, timeoutMs = 3 * 60 * 60 * 1000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`${label} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function registerSource(sourceFile: string, sourceId: string): Promise<Result> {
  const { sourceDir } = await import("@/lib/clipping/sources");
  const { runFfmpeg } = await import("@/lib/clipping/ffmpeg");
  const dir = sourceDir(sourceId);
  await mkdir(dir, { recursive: true });
  const stored = path.join(dir, "source.mp4");
  await link(sourceFile, stored).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", stored], { allowFailure: true });
  const duration = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const dims = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const meta = {
    id: sourceId,
    fileName: "bench-source.mp4",
    storedName: "source.mp4",
    mime: "video/mp4",
    sizeBytes: (await stat(stored)).size,
    durationSec: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0,
    width: dims ? Number(dims[1]) : 0,
    height: dims ? Number(dims[2]) : 0,
    hasAudio: /Stream #\d+:\d+.*Audio/.test(stderr),
    createdAt: new Date().toISOString()
  };
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return { sourceId, durationSec: meta.durationSec };
}

async function longformPrepare(sourceId: string, topicStart: number, topicEnd: number): Promise<Result> {
  const store = await import("@/lib/longform/store");
  const created = await store.createProject(sourceId, "Bench long-form");
  const ready = await waitFor(() => store.getProject(created.id), (project) => !project || project.status !== "processing", "long-form analysis");
  if (!ready || ready.status !== "ready") throw new Error(`analysis failed: ${ready?.error ?? "project vanished"}`);
  await store.updateProject(created.id, {
    topics: [
      {
        id: "bench-late-topic",
        title: "Late topic segment",
        summary: "A segment far into the recording",
        start: topicStart,
        end: topicEnd,
        keywords: ["bench"],
        titleSource: "fallback"
      }
    ]
  });
  return { projectId: created.id };
}

async function longformExport(projectId: string, topicId: string): Promise<Result> {
  const store = await import("@/lib/longform/store");
  const { startLongformExport } = await import("@/lib/longform/render");
  const project = await store.getProject(projectId);
  if (!project) throw new Error("bench project missing; run longform-prepare first");
  const record = await startLongformExport(project, { topicId });
  const finished = await waitFor(
    async () => (await store.getProject(projectId))?.exports.find((item) => item.id === record.id),
    (item) => !item || item.status !== "processing",
    "long-form export"
  );
  if (!finished || finished.status !== "done" || !finished.file) throw new Error(`export failed: ${finished?.error ?? "record vanished"}`);
  return { recordId: record.id, outputs: [path.join(store.projectOutputDir(projectId), finished.file)] };
}

async function clipJob(sourceId: string, clipCount: number): Promise<Result> {
  const jobs = await import("@/lib/clipping/jobs");
  const created = await jobs.createJobFromUpload(sourceId, undefined, clipCount, false);
  const finished = await waitFor(() => jobs.getJob(created.id), (job) => !job || job.status === "done" || job.status === "error", "clip job");
  if (!finished || finished.status !== "done") throw new Error(`clip job failed: ${finished?.error ?? "job vanished"}`);
  const dir = jobs.outputDir(created.id);
  const outputs = finished.clips.flatMap((clip) => [clip.file, clip.downloadFile].filter(Boolean).map((name) => path.join(dir, name as string)));
  return {
    jobId: created.id,
    clips: finished.clips.map((clip) => ({ start: clip.start, end: clip.end, title: clip.title })),
    transcriptSegments: finished.sourceCaptions?.length ?? 0,
    outputs
  };
}

async function shortExport(sourceId: string, sectionStart: number, sectionSec: number): Promise<Result> {
  const { readSourceMeta, sourceFilePath } = await import("@/lib/clipping/sources");
  const { runFfmpeg } = await import("@/lib/clipping/ffmpeg");
  const { outputDir, workDir } = await import("@/lib/clipping/jobs");
  const { getExport, startExport } = await import("@/lib/clipping/export");
  const { defaultCaptionStyle } = await import("@/lib/storage/schemas");
  const meta = await readSourceMeta(sourceId);
  if (!meta) throw new Error("source missing");
  const jobId = "benchshort";
  await mkdir(outputDir(jobId), { recursive: true });
  await mkdir(workDir(jobId), { recursive: true });
  const base = path.join(outputDir(jobId), "clip-base.mp4");
  await runFfmpeg(["-y", "-ss", sectionStart.toFixed(2), "-i", sourceFilePath(meta), "-t", sectionSec.toFixed(2), "-c", "copy", base]);
  const words = Array.from({ length: Math.floor(sectionSec / 0.5) }, (_, index) => ({
    text: SYNTHETIC_WORDS[index % SYNTHETIC_WORDS.length],
    start: index * 0.5,
    end: index * 0.5 + 0.45
  }));
  const captions = [] as Array<{ id: string; start: number; end: number; text: string; words: typeof words; enabled: boolean }>;
  for (let index = 0; index < words.length; index += 4) {
    const group = words.slice(index, index + 4);
    captions.push({ id: `c${index}`, start: group[0].start, end: group[group.length - 1].end, text: group.map((word) => word.text).join(" "), words: group, enabled: true });
  }
  const record = startExport({
    jobId,
    sourceFile: "clip-base.mp4",
    baseDurationSec: sectionSec,
    trimStart: 0,
    trimEnd: sectionSec,
    compositionMode: "crop-fill",
    reframe: { scale: 1.15, offsetX: 0.2, offsetY: 0 },
    captions,
    captionStyle: { ...defaultCaptionStyle, animation: "karaoke" },
    captionsVisible: true,
    highlightCurrentWord: true,
    overlays: [],
    audio: { clipVolume: 1, fadeIn: 0.3, fadeOut: 0.3, musicVolume: 0.5 },
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
      filename: "bench-short"
    }
  } as Parameters<typeof startExport>[0]);
  const finished = await waitFor(() => getExport(record.id), (item) => !item || item.status === "done" || item.status === "error", "short export");
  if (!finished || finished.status !== "done") throw new Error(`short export failed: ${finished?.error ?? "record vanished"}`);
  return { outputs: [path.join(outputDir(jobId), finished.file as string)] };
}

function guardFetchToMock(mockBase: string) {
  const realFetch = globalThis.fetch;
  const mock = new URL(mockBase);
  if (!["127.0.0.1", "localhost"].includes(mock.hostname)) throw new Error("mock server must be local");
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.hostname.endsWith("googleapis.com")) {
      url.protocol = mock.protocol;
      url.host = mock.host;
    }
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error(`bench refused a non-local request to ${url.hostname}`);
    return realFetch(url, init);
  }) as typeof fetch;
}

async function youtubeUpload(mockBase: string, file: string): Promise<Result> {
  guardFetchToMock(mockBase);
  process.env.YOUTUBE_CLIENT_ID = "bench-client";
  process.env.YOUTUBE_CLIENT_SECRET = "bench-secret";
  process.env.YOUTUBE_REFRESH_TOKEN = "bench-refresh";
  const { newPlatformState } = await import("@/lib/publisher/queue");
  const { youtubeAdapter } = await import("@/lib/publisher/adapters/youtube");
  const item = {
    id: "bench-upload",
    clipPath: file,
    title: "Bench upload",
    caption: "Bench upload",
    hashtags: [],
    publishAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    visibility: "private",
    format: "long",
    createdAt: new Date().toISOString(),
    platforms: { youtube: newPlatformState() }
  };
  const result = await youtubeAdapter.publish({ item, localPath: file } as Parameters<typeof youtubeAdapter.publish>[0]);
  const received = await (await globalThis.fetch(new URL("/bench/last", mockBase))).json();
  return { postId: result.postId, received, sizeBytes: (await stat(file)).size };
}

async function main() {
  const [scenario, ...args] = process.argv.slice(2);
  countSpawns();
  installSyntheticTranscriber();
  let result: Result;
  if (scenario === "register-source") result = await registerSource(args[0], args[1]);
  else if (scenario === "longform-prepare") result = await longformPrepare(args[0], Number(args[1]), Number(args[2]));
  else if (scenario === "longform-export") result = await longformExport(args[0], args[1] ?? "bench-late-topic");
  else if (scenario === "clip-job") result = await clipJob(args[0], Number(args[1] ?? 3));
  else if (scenario === "short-export") result = await shortExport(args[0], Number(args[1] ?? 1320), Number(args[2] ?? 30));
  else if (scenario === "youtube-upload") result = await youtubeUpload(args[0], args[1]);
  else throw new Error(`unknown scenario ${scenario}`);
  console.log(`BENCH_RESULT ${JSON.stringify({ ...result, spawned })}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("BENCH_FAILED", error instanceof Error ? error.stack : error);
  process.exit(1);
});
