// render-slides-for-ppt.mjs — Renders each slide composition into ./ppt as
// slide-01.mp4 … slide-14.mp4, the exact filenames build-pptx.py expects.
// Run via `npm run pptx`, which then assembles the PowerPoint.
import { execSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";

const SLIDES = [
  "Slide01Hook",
  "Slide02Split",
  "Slide03Fear",
  "Slide04Reframe",
  "Slide05Internet",
  "Slide06Claim",
  "Slide07Faster",
  "Slide08Choice",
  "Slide09Pivot",
  "Slide10OnePerson",
  "Slide11Colateral",
  "Slide12Enterprise",
  "Slide13Philosophy",
  "Slide14Close",
];

mkdirSync("ppt", { recursive: true });

// Optional: point Remotion at a specific Chromium (e.g. a locked-down CI box).
// Set REMOTION_BROWSER to an executable path to pass --browser-executable.
const browser = process.env.REMOTION_BROWSER;
const extra = browser ? ` --browser-executable=${browser}` : "";

for (let i = 0; i < SLIDES.length; i++) {
  const out = `ppt/slide-${String(i + 1).padStart(2, "0")}.mp4`;
  if (process.env.SKIP_EXISTING && existsSync(out)) {
    console.log(`↷ ${out} exists, skipping`);
    continue;
  }
  console.log(`\n▶ Rendering ${SLIDES[i]} → ${out}`);
  execSync(`npx remotion render ${SLIDES[i]} ${out}${extra}`, {
    stdio: "inherit",
  });
}

console.log("\n✅ All slide clips rendered into ./ppt");
