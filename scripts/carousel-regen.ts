import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import type { TranscriptSegment } from "@/lib/carousels/anchors";
import { latestDeskRecording } from "@/lib/carousels/bRoll";
import { footageKind } from "@/lib/carousels/footage";
import { generateCarousel, illustrateFromRecording } from "@/lib/studio/carousel";

config({ path: path.join(process.cwd(), ".env"), quiet: true });

/**
 * Writes one carousel from a stored long-form project and illustrates it, then
 * saves the deck to a file instead of into the app's store. What the nightly run
 * does, without booking anything — for looking at a change to the copy rules or
 * the footage check against a real recording before it ships.
 *
 *   npx tsx scripts/carousel-regen.ts --project <id> --out deck.json --slides 8
 */

type StoredProject = {
  id: string;
  name: string;
  sourceId: string;
  transcript?: TranscriptSegment[];
};

async function main() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);

  const projectId = args.get("project");
  const out = args.get("out");
  if (!projectId || !out) throw new Error("usage: --project <id> --out <file> [--slides 8]");
  const slideCount = Number(args.get("slides") ?? 8);
  const dataDir = process.env.CAPITAL_COMMAND_DATA_DIR ?? path.join(process.cwd(), "data");

  const stored = JSON.parse(await readFile(path.join(dataDir, "longform", "projects.json"), "utf8")) as
    | StoredProject[]
    | { projects: StoredProject[] };
  const projects = Array.isArray(stored) ? stored : stored.projects;
  const project = projects.find((entry) => entry.id === projectId || entry.id.startsWith(projectId));
  if (!project) throw new Error(`no project matching "${projectId}"`);

  console.log(`source: ${project.name}`);
  console.log(`footage: ${await footageKind(project.sourceId)}`);
  console.log(`b-roll: ${JSON.stringify(await latestDeskRecording(project.sourceId))}`);

  const transcript = project.transcript ?? [];
  const generated = await generateCarousel({
    title: project.name,
    sourceText: transcript.map((segment) => segment.text).join(" "),
    slideCount,
    sourceType: "longform",
    sourceId: project.id,
    imageMode: "backdrop",
    transcript,
    requireModel: true
  });
  if (!generated.carousel) throw new Error(`no deck written: ${generated.reason}`);
  console.log(`wrote ${generated.carousel.slides.length} slides`);
  console.log(`hook retries: ${generated.hookRetries ?? 0}`);

  const illustrated = await illustrateFromRecording({
    carousel: generated.carousel,
    drafts: generated.drafts ?? [],
    sourceId: project.sourceId,
    transcript
  });
  console.log(`illustration: ${illustrated.note ?? "every slide got a still"}`);
  const bare = illustrated.carousel.slides.filter((slide) => !(slide.layers ?? []).length).length;
  console.log(`slides with no picture: ${bare}`);

  const deck = {
    ...illustrated.carousel,
    hookRetries: generated.hookRetries ?? 0,
    illustrationNote: illustrated.note
  };
  await writeFile(out, JSON.stringify(deck, null, 2));
  console.log(`saved -> ${out}`);
}

main();
