/** Local painter proof only. No AI, app state, tokens, queue or network calls. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import * as currentPainter from "@/lib/carousels/render";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/defaults";
import { attachSlideBackdrops } from "@/lib/carousels/imageSlides";
import { carouselEditorialExample } from "../samples/carousel-editorial";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args[args.indexOf(name) + 1];
  if (!args.includes("--image") || !args.includes("--out")) throw new Error("Use --image <workspace-office.webp> --out <new temp directory> [--theme black|light] [--painter <baseline render.ts>].");
  const imageFile = path.resolve(flag("--image"));
  const out = path.resolve(flag("--out"));
  const relative = path.relative(os.tmpdir(), out);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("The proof output must be a named directory under the system temp folder.");
  const theme = args.includes("--theme") ? flag("--theme") : "black";
  if (theme !== "black" && theme !== "light") throw new Error("Theme must be black or light.");
  const painter: typeof currentPainter = args.includes("--painter") ? await import(pathToFileURL(path.resolve(flag("--painter"))).href) : currentPainter;
  const bytes = await readFile(imageFile);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== carouselEditorialExample.source.imageSha256) throw new Error("The source screenshot does not match this example's documented capture.");
  for (const weight of painter.SLIDE_FONT_WEIGHTS) {
    if (!GlobalFonts.registerFromPath(path.join(process.cwd(), "public", "fonts", "slides", `inter-${weight}.woff2`), "Inter")) throw new Error(`Could not register Inter ${weight}.`);
  }
  painter.setSlideTheme(theme);
  painter.setSlideSignature(DEFAULT_BRAND_KIT.carousel.signature);
  const image = await loadImage(bytes);
  const src = "local-proof-workspace";
  const images = new Map([[src, image]]);
  const slides = carouselEditorialExample.slides.map((slide, index) => index === 1 ? attachSlideBackdrops([slide], [{ id: "workspace-proof", url: src }])[0] : slide);
  await mkdir(out, { recursive: true });
  const contact = createCanvas(1080, 675);
  const contactContext = contact.getContext("2d");
  for (const [index, slide] of slides.entries()) {
    const canvas = createCanvas(1080, 1350);
    painter.paintSlide(canvas.getContext("2d"), { slide, index, total: slides.length, width: 1080, height: 1350, images });
    await writeFile(path.join(out, `slide-${String(index + 1).padStart(2, "0")}.png`), canvas.toBuffer("image/png"));
    contactContext.drawImage(canvas, (index % 4) * 270, Math.floor(index / 4) * 337.5, 270, 337.5);
  }
  await writeFile(path.join(out, "contact.png"), contact.toBuffer("image/png"));
  await writeFile(path.join(out, "source-and-copy.json"), JSON.stringify({ ...carouselEditorialExample, imageFile, sha256, theme, painter: args.includes("--painter") ? flag("--painter") : "current src/lib/carousels/render.ts", slides }, null, 2) + "\n");
  console.log(`Painted ${slides.length} authored example slides with the ${theme} painter into ${out}. No model or publication was run.`);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
