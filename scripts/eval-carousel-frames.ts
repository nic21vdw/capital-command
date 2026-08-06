import { mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { framesForSlides } from "@/lib/carousels/videoFrames";
import { carouselImagePath } from "@/lib/carousels/uploads";
import { readSourceMeta } from "@/lib/clipping/sources";
import { generateCarousel, resolveSlideCount } from "@/lib/studio/carousel";

config({ path: path.join(process.cwd(), ".env"), quiet: true });

type Args = { source: string; slides: number; out: string };

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback: string) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  return {
    source: get("source", ""),
    slides: Number(get("slides", "8")),
    out: get("out", path.join(process.cwd(), "eval-out"))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source) throw new Error("--source <sourceId> is required");

  const meta = await readSourceMeta(args.source);
  if (!meta) throw new Error(`No source ${args.source}`);

  const transcript = JSON.parse(
    await readFile(path.join(process.cwd(), "data", "clips", "sources", args.source, "transcript.json"), "utf8")
  ) as Array<{ start: number; end: number; text: string }>;
  const sourceText = transcript.map((segment) => segment.text).join(" ");

  const count = resolveSlideCount({ slideCount: args.slides });
  console.log(`source ${meta.fileName}\n  ${Math.round(meta.durationSec)}s, ${transcript.length} segments, ${sourceText.length} chars`);

  const started = Date.now();
  const result = await generateCarousel({
    title: meta.fileName.replace(/\.[^.]+$/, ""),
    sourceText,
    slideCount: count,
    sourceType: "longform",
    sourceId: args.source,
    imageMode: "backdrop",
    transcript,
    requireModel: true
  });
  if (!result.carousel) throw new Error(`No carousel: ${result.reason}`);
  console.log(`  copy: ${result.carousel.slides.length} slides in ${Math.round((Date.now() - started) / 1000)}s${result.reason ? ` — ${result.reason}` : ""}`);

  const frames = await framesForSlides({ sourceId: args.source, slides: result.drafts, segments: transcript });
  console.log(`  frames: ${frames.images.length}/${result.drafts.length}${frames.note ? ` — ${frames.note}` : ""}`);

  await rm(args.out, { recursive: true, force: true });
  await mkdir(args.out, { recursive: true });

  const report = [];
  for (const [index, slide] of result.carousel.slides.entries()) {
    const image = frames.images[index];
    let file: string | null = null;
    const stored = image ? carouselImagePath(image.id) : null;
    if (stored) {
      file = `slide-${String(index + 1).padStart(2, "0")}.jpg`;
      await copyFile(stored, path.join(args.out, file));
    }
    report.push({
      slide: index + 1,
      heading: slide.heading,
      body: slide.body,
      seconds: frames.anchors[index]?.seconds ?? null,
      anchoredBy: frames.anchors[index]?.from ?? null,
      modelSaid: result.drafts[index]?.atSeconds ?? null,
      file
    });
  }

  await writeFile(
    path.join(args.out, "slides.json"),
    JSON.stringify({ source: args.source, fileName: meta.fileName, durationSec: meta.durationSec, slides: report }, null, 2),
    "utf8"
  );

  for (const entry of report) {
    console.log(`\n#${entry.slide} @${entry.seconds ?? "—"}s (${entry.anchoredBy}) ${entry.file ?? "(no still)"}`);
    console.log(`  ${entry.heading}`);
    if (entry.body) console.log(`  ${entry.body}`);
  }
  console.log(`\nWrote ${args.out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
