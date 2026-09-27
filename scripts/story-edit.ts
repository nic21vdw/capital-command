import { config } from "dotenv";
import path from "node:path";
config({ path: path.join(process.cwd(), ".env"), quiet: true });
import { readFile } from "node:fs/promises";
import { runStages, STAGES } from "@/lib/story/pipeline";
import { tokenFromFile } from "@/lib/story/youtube";
import { runProcess } from "@/lib/story/render";
import { exists, projectFile, readStatus, updateStatus, type StoryStage } from "@/lib/story/store";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function youtubeId(url: string): string | null {
  return /(?:v=|youtu\.be\/|live\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(url)?.[1] ?? null;
}

async function probe(file: string): Promise<{ durationSec: number; width: number; height: number }> {
  const { execFile } = await import("node:child_process");
  const out = await new Promise<string>((resolve, reject) =>
    execFile(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file],
      (error, stdout) => (error ? reject(error) : resolve(String(stdout)))
    )
  );
  const data = JSON.parse(out) as { streams: Array<{ width: number; height: number }>; format: { duration: string } };
  return { durationSec: Number(data.format.duration), width: data.streams[0].width, height: data.streams[0].height };
}

async function main() {
  const url = arg("url");
  const id = arg("id") ?? (url ? youtubeId(url) : null);
  if (!id) throw new Error("Usage: npm run story:edit -- --url <youtube link> | --id <project> [--source file] [--stages a,b] [--upload --tokens-file path]");
  const sourcePath = arg("source") ?? projectFile(id, "source.mp4");

  if (!(await exists(sourcePath))) {
    if (!url) throw new Error(`No source video at ${sourcePath}.`);
    console.log("downloading the source at 1080p");
    await runProcess("yt-dlp", [
      "--no-playlist", "--js-runtimes", `node:${process.execPath}`,
      "-f", "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba",
      "--merge-output-format", "mp4", "-N", "8", "-o", sourcePath, url
    ]);
  }

  const existing = await readStatus(id);
  if (!existing || !existing.durationSec || arg("title")) {
    const meta = await probe(sourcePath);
    const info = await readFile(projectFile(id, "info.json"), "utf8").then((text) => JSON.parse(text) as { title?: string }).catch(() => null);
    await updateStatus(id, { title: arg("title") ?? info?.title ?? existing?.title ?? id, sourceUrl: url ?? existing?.sourceUrl, sourcePath, ...meta }, "project created");
  }

  const requested = arg("stages")?.split(",").map((stage) => stage.trim()) as StoryStage[] | undefined;
  const stages = [...(requested ?? STAGES)];
  if (process.argv.includes("--upload") && !stages.includes("upload")) stages.push("upload", "package");
  const started = Date.now();
  await runStages(id, stages, {
    accessToken: tokenFromFile(arg("tokens-file")),
    log: (message) => console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${message}`)
  });
  console.log(`done: ${projectFile(id, "package")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
