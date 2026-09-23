import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { falConfigured } from "@/lib/music/fal";

// ----- Watching a passage before it goes in -----
// A passage can read perfectly and still not work as video: the words say
// "look at this" over a loading spinner, the screen is on a private message,
// or the picture only makes sense after something the edit cut. So every
// passage the best-of edit keeps is WATCHED before it goes in: six frames from
// across it, tiled into one contact sheet, shown to a vision model with the
// words spoken over them and where the passage sits in the story.
//
// Two ways to see, both optional and both failing open to the visual scan:
// Claude directly when ANTHROPIC_API_KEY is set, and fal's vision gateway
// (the one the carousel frame check already uses) when FAL_KEY is.

const FRAMES = 6;
const FRAME_WIDTH = 480;
const REQUEST_TIMEOUT_MS = 45_000;
const FAL_ENDPOINT = "https://fal.run/fal-ai/any-llm/vision";
/** The model the carousel frame check was calibrated on; see carousels/relevance.ts. */
const FAL_MODEL = "anthropic/claude-haiku-4.5";
const DEFAULT_ANTHROPIC_VISION_MODEL = "claude-haiku-4-5";

export type VisionProblem = "none" | "blank" | "loading" | "sensitive" | "offscreen" | "unreadable" | "unrelated";

export type VisionReview = {
  verdict: "keep" | "drop";
  /** 1-10: how well the picture carries the words. */
  score: number;
  /** What was on screen, in a few words. */
  see: string;
  /** What a viewer would be missing, or "". */
  context: string;
  problem: VisionProblem;
};

export function visionReviewConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim()) || falConfigured();
}

/** Six moments across a passage: just inside each edge and four evenly between. Pure. */
export function contactSheetTimes(start: number, end: number): number[] {
  const length = Math.max(0, end - start);
  const inset = Math.min(1, length / 10);
  const first = start + inset;
  const last = end - inset;
  return Array.from({ length: FRAMES }, (_, index) =>
    Math.round((first + ((last - first) * index) / (FRAMES - 1)) * 1000) / 1000
  );
}

/** Six frames from the source tiled 3x2 into one JPEG, left to right, top to bottom. */
export async function buildContactSheet(input: {
  srcPath: string;
  times: number[];
  workDir: string;
  id: string;
}): Promise<Uint8Array> {
  const dir = path.join(input.workDir, `sheet-${input.id}`);
  await mkdir(dir, { recursive: true });
  try {
    for (const [index, time] of input.times.entries()) {
      await runFfmpeg([
        "-y",
        "-hide_banner",
        "-ss",
        Math.max(0, time).toFixed(3),
        "-i",
        input.srcPath,
        "-frames:v",
        "1",
        "-vf",
        `scale=${FRAME_WIDTH}:-2:flags=lanczos`,
        "-q:v",
        "4",
        path.join(dir, `f-${index + 1}.jpg`)
      ]);
    }
    const sheetPath = path.join(dir, "sheet.jpg");
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-start_number",
      "1",
      "-i",
      path.join(dir, "f-%d.jpg"),
      "-vf",
      "tile=3x2:padding=6:color=black",
      "-frames:v",
      "1",
      "-q:v",
      "4",
      sheetPath
    ]);
    return new Uint8Array(await readFile(sheetPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** The question asked about one passage. Pure, for tests. */
export function buildVisionPrompt(input: {
  premise?: string;
  role?: string;
  words: string;
  previousWords?: string;
  times: number[];
}): string {
  return [
    "You are the editor checking one passage of a live stream before it goes into an edited YouTube video.",
    "The image is six frames from this passage in order, left to right then top to bottom, taken at " +
      `${input.times.map(clock).join(", ")} into the stream.`,
    "",
    input.premise ? `What the video is about: ${input.premise}` : "",
    input.role ? `This passage's job in the story: ${input.role}` : "",
    input.previousWords ? `The edit plays this just before it: "${input.previousWords.slice(-300)}"` : "",
    `Words spoken over these frames: "${input.words.replace(/\s+/g, " ").trim().slice(0, 1500)}"`,
    "",
    "Answer in exactly this format:",
    "SEE: <what is on screen, under 20 words; name the app or subject>",
    "MATCH: <yes or no: does the picture fit what is being said>",
    "CONTEXT: <none, or what a viewer would need to have seen that is not in these frames or words>",
    "PROBLEM: <none | blank | loading | sensitive | offscreen | unreadable | unrelated>",
    "VERDICT: <keep or drop>",
    "SCORE: <1-10>",
    "",
    "Drop it when the screen is blank, a loading, starting-soon or be-right-back screen; when it shows a password, an API key, a private message, an email inbox or anything personal; when the words point at something on screen that is not visible; when the picture is unrelated to the words in a way that would confuse a viewer; or when it only makes sense after something the viewer has not seen.",
    "Keep it when the speaker is on camera talking, or the screen shows the editor, terminal, app or page being talked about, even if the words are opinion or explanation rather than narration of the screen."
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const PROBLEMS: VisionProblem[] = ["none", "blank", "loading", "sensitive", "offscreen", "unreadable", "unrelated"];

/** Reads the review out of the reply, or null when it did not follow the format. Pure. */
export function parseVisionReview(text: string): VisionReview | null {
  const field = (name: string) => text.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "im"))?.[1].trim() ?? "";
  const verdictText = field("VERDICT").toLowerCase();
  const scoreText = field("SCORE").match(/\d+(?:\.\d+)?/)?.[0];
  if (!verdictText || !scoreText) return null;
  const problemText = field("PROBLEM").toLowerCase();
  const problem = PROBLEMS.find((item) => problemText.startsWith(item)) ?? "none";
  const context = field("CONTEXT");
  // A sensitive screen is dropped whatever the verdict line says: it cannot
  // be published, and a model that noticed it but kept it is wrong.
  const verdict = problem === "sensitive" || verdictText.startsWith("drop") ? "drop" : "keep";
  return {
    verdict,
    score: Math.min(10, Math.max(1, Number(scoreText))),
    see: field("SEE").slice(0, 160),
    context: /^none\b/i.test(context) ? "" : context.slice(0, 200),
    problem
  };
}

async function askClaude(prompt: string, jpeg: Uint8Array, signal: AbortSignal): Promise<string | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create(
    {
      model: process.env.ANTHROPIC_VISION_MODEL?.trim() || DEFAULT_ANTHROPIC_VISION_MODEL,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(jpeg).toString("base64") } },
            { type: "text", text: prompt }
          ]
        }
      ]
    },
    { signal }
  );
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("\n");
}

async function askFal(prompt: string, jpeg: Uint8Array, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(FAL_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: FAL_MODEL,
      prompt,
      image_url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`
    }),
    signal
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { output?: unknown };
  return typeof data.output === "string" ? data.output : null;
}

/**
 * Watches one passage. Never throws: no credential, a failed frame grab or an
 * unreadable reply all come back as null, and the edit falls back to what the
 * visual scan said about the passage.
 */
export async function reviewPassageVisually(input: {
  srcPath: string;
  workDir: string;
  id: string;
  start: number;
  end: number;
  words: string;
  premise?: string;
  role?: string;
  previousWords?: string;
}): Promise<VisionReview | null> {
  if (!visionReviewConfigured()) return null;
  const times = contactSheetTimes(input.start, input.end);
  let jpeg: Uint8Array;
  try {
    jpeg = await buildContactSheet({ srcPath: input.srcPath, times, workDir: input.workDir, id: input.id });
  } catch {
    return null;
  }
  const prompt = buildVisionPrompt({ ...input, times });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const reply = process.env.ANTHROPIC_API_KEY?.trim()
      ? await askClaude(prompt, jpeg, controller.signal).catch(() => null)
      : null;
    const text = reply ?? (falConfigured() ? await askFal(prompt, jpeg, controller.signal).catch(() => null) : null);
    return text ? parseVisionReview(text) : null;
  } finally {
    clearTimeout(timer);
  }
}
