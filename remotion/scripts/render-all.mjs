// render-all.mjs — Renders every slide composition to its own MP4 in ./out,
// then renders the stitched FullVideo. Run with `npm run render:all`.
//
// Output files are named slide-01-hook.mp4 ... slide-14-close.mp4 so they sort
// correctly when you import them into PowerPoint.
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

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

const kebab = (id, i) =>
  `slide-${String(i + 1).padStart(2, "0")}-${id
    .replace(/^Slide\d+/, "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()}`;

mkdirSync("out", { recursive: true });

for (let i = 0; i < SLIDES.length; i++) {
  const id = SLIDES[i];
  const outFile = `out/${kebab(id, i)}.mp4`;
  console.log(`\n▶ Rendering ${id} → ${outFile}`);
  execSync(`npx remotion render ${id} ${outFile}`, { stdio: "inherit" });
}

console.log("\n▶ Rendering FullVideo → out/full-video.mp4");
execSync(`npx remotion render FullVideo out/full-video.mp4`, {
  stdio: "inherit",
});

console.log("\n✅ All renders complete. Files are in ./out");
