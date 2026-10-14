import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { buildCarouselPdf } from "@/lib/carousels/pdf";

let dir: string;

async function slide(name: string, width: number, height: number, color: string): Promise<string> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  const file = path.join(dir, name);
  await writeFile(file, canvas.toBuffer("image/png"));
  return file;
}

beforeAll(async () => {
  dir = path.join(os.tmpdir(), `carousel-pdf-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
});

describe("buildCarouselPdf", () => {
  it("renders every slide as one page of a real PDF", async () => {
    const slides = [
      await slide("a.png", 108, 135, "#112233"),
      await slide("b.png", 108, 135, "#445566"),
      await slide("c.png", 108, 135, "#778899")
    ];

    const pdf = await buildCarouselPdf(slides, { title: "Three slides" });

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-6).toString("latin1")).toContain("%%EOF");
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? [];
    expect(pages).toHaveLength(3);
  });

  it("takes each page's shape from its slide", async () => {
    const pdf = await buildCarouselPdf([await slide("tall.png", 100, 200, "#000000")]);
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+100\s+200\s*\]/);
  });

  it("refuses an empty deck and a missing slide file", async () => {
    await expect(buildCarouselPdf([])).rejects.toThrow("at least one slide");
    await expect(buildCarouselPdf([path.join(dir, "missing.png")])).rejects.toThrow();
  });
});
