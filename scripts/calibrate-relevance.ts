import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { buildRelevancePrompt, parseRelevance } from "@/lib/carousels/relevance";

config({ path: path.join(process.cwd(), ".env"), quiet: true });

const truth = [
  {
    file: "slide-02.jpg",
    heading: "Claude runs inside CoLateral",
    body: "You can literally say 'CLI me' and Claude starts working in the terminal.",
    expect: 10
  },
  { file: "slide-01.jpg", heading: "Day 27. $0 revenue. Let's freaking go.", body: "", expect: 9 },
  {
    file: "slide-05.jpg",
    heading: "Whisper just joined the workflow",
    body: "Local speech-to-text, no internet needed.",
    expect: 4
  },
  {
    file: "slide-06.jpg",
    heading: "Inside CoLateral's terminal layout",
    body: "Opening the app and locking in the layout for the engineering workspace.",
    expect: 5
  },
  {
    file: "slide-07.jpg",
    heading: "Transcript in. Clips out.",
    body: "Turning one stream into clips for every platform.",
    expect: 4
  },
  // Personal talk that happens to name the product: a plan, not a claim about
  // the picture, so a clean shot of him is a pass.
  {
    file: "slide-08.jpg",
    heading: "Follow to see what's next",
    body: "This is just the start.",
    expect: 8
  },
  {
    file: "slide-01.jpg",
    heading: "CoLateral launches August 1st",
    body: "Revenue: $0.00. Mission: moving out.",
    expect: 8
  }
];

const models = ["anthropic/claude-haiku-4.5"];

async function rate(model: string, file: string, slide: { heading: string; body: string }) {
  const b64 = fs.readFileSync(path.join("eval-out", "round9a", file)).toString("base64");
  const response = await fetch("https://fal.run/fal-ai/any-llm/vision", {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: buildRelevancePrompt(slide),
      image_url: `data:image/jpeg;base64,${b64}`
    })
  });
  if (!response.ok) return `HTTP ${response.status}`;
  const data = (await response.json()) as { output?: string };
  return parseRelevance(data.output ?? "");
}

async function main() {
  for (const model of models) {
    const results: string[] = [];
    for (const entry of truth) {
      results.push(`${entry.file.slice(6, 8)} want~${entry.expect} got ${await rate(model, entry.file, entry)}`);
    }
    console.log(model.padEnd(30), results.join(" | "));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
