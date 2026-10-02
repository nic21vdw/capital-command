import path from "node:path";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.resolve("src", specifier.slice(2));
      const file = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(existsSync);
      if (!file) throw new Error(`Missing module: ${specifier}`);
      return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (/\.tsx?$/.test(url)) {
      const file = fileURLToPath(url);
      return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
      }).outputText };
    }
    return nextLoad(url, context);
  }
});

const { verticalCompositionChain } = await import("../src/lib/clipping/render.ts");
const { resolveOutputFrame, masterVideoArgs, containScale } = await import("../src/lib/clipping/encode.ts");
const { buildAss } = await import("../src/lib/clipping/captions.ts");
const { assFilter } = await import("../src/lib/clipping/caption-fonts.ts");
const { defaultCaptionStyle } = await import("../src/lib/storage/schemas.ts");
const source = { width: 3840, height: 2160, fps: 59.94 };
const frame = resolveOutputFrame(source, undefined, "vertical");
const target = { sourceW: source.width, sourceH: source.height, targetW: frame.width, targetH: frame.height };
const captionPath = path.resolve("qa", "quality.ass");
writeFileSync(captionPath, buildAss([{
  id: "fixture-caption", start: 0, end: 1, enabled: true, text: "4K QUALITY CHECK",
  words: [{ text: "4K", start: 0, end: 0.05 }, { text: "QUALITY", start: 0.05, end: 0.1 }, { text: "CHECK", start: 0.1, end: 1 }]
}], defaultCaptionStyle, frame.width, frame.height, true));
const escapeFilterPath = (file) => file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
const cases = [
  { name: "captioned-4k", frame, filter: `${verticalCompositionChain(undefined, undefined, frame)};[vc]${assFilter(captionPath, escapeFilterPath)}[vout]`, label: "vout" },
  { name: "subject-4k", frame, filter: verticalCompositionChain({
      framing: { mode: "subject-fill", crop: { w: 0.32, h: 1 }, keyframes: [{ t: 0, x: 0.5, y: 0 }], confidence: 1, reason: "fixture" }, target
    }, undefined, frame), label: "vc" },
  { name: "stack-4k", frame, filter: verticalCompositionChain({
      framing: { mode: "speaker-stack", faceSource: { x: 0.7, y: 0.6, w: 0.24, h: 0.34 }, confidence: 1, reason: "fixture" }, target
    }, undefined, frame), label: "vc" },
  { name: "capped-720", frame: resolveOutputFrame(source, { resolution: "720", frameRate: "30" }, "vertical"), label: "vc" },
  { name: "wide-4k", frame: resolveOutputFrame(source), label: "vc" }
];
for (const item of cases) {
  item.file = path.resolve("qa", `${item.name}.mp4`);
  item.filter ??= item.name.startsWith("wide")
    ? `[0:v]${containScale(item.frame.width, item.frame.height)},setsar=1[vc]`
    : verticalCompositionChain(undefined, undefined, item.frame);
  item.args = ["-y", "-hide_banner", "-loglevel", "error", "-threads", "1", "-f", "lavfi", "-i",
    "testsrc2=size=3840x2160:rate=60000/1001:duration=0.15", "-filter_complex_threads", "1", "-filter_complex", item.filter,
    "-map", `[${item.label}]`, "-an", "-r", String(item.frame.fps), ...masterVideoArgs(), "-threads", "1",
    "-frames:v", "4", "-movflags", "+faststart", item.file];
}
writeFileSync(path.resolve("qa", "media-plan.json"), JSON.stringify(cases, null, 2));
console.log(`Planned ${cases.length} real-media checks from the application filters.`);
