import type { SKRSContext2D } from "@napi-rs/canvas";

const JPEG_QUALITY = 88;
const HEADER = Buffer.concat([Buffer.from("%PDF-1.4\n%", "latin1"), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]), Buffer.from("\n", "latin1")]);

export type CarouselPdfOptions = {
  title?: string;
};

type Slide = { width: number; height: number; jpeg: Buffer };

async function readSlide(imagePath: string): Promise<Slide> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d") as SKRSContext2D;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0, image.width, image.height);
  return { width: image.width, height: image.height, jpeg: canvas.toBuffer("image/jpeg", JPEG_QUALITY) };
}

function textString(value: string): string {
  const units = Buffer.from(`﻿${value}`, "utf16le").swap16();
  return `<${units.toString("hex")}>`;
}

function dictionaryObject(id: number, body: string): Buffer {
  return Buffer.from(`${id} 0 obj\n${body}\nendobj\n`, "latin1");
}

function streamObject(id: number, dictionary: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`${id} 0 obj\n<< ${dictionary} /Length ${data.length} >>\nstream\n`, "latin1"),
    data,
    Buffer.from("\nendstream\nendobj\n", "latin1")
  ]);
}

export async function buildCarouselPdf(imagePaths: string[], options: CarouselPdfOptions = {}): Promise<Buffer> {
  if (imagePaths.length === 0) throw new Error("A PDF carousel needs at least one slide.");
  const slides: Slide[] = [];
  for (const imagePath of imagePaths) slides.push(await readSlide(imagePath));

  const pageIds = slides.map((_, index) => 3 + index * 3);
  const infoId = 3 + slides.length * 3;
  const objects: Buffer[] = [
    dictionaryObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    dictionaryObject(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${slides.length} >>`)
  ];
  slides.forEach((slide, index) => {
    const page = pageIds[index];
    objects.push(
      dictionaryObject(
        page,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${slide.width} ${slide.height}] ` +
          `/Resources << /XObject << /Im0 ${page + 2} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${page + 1} 0 R >>`
      ),
      streamObject(page + 1, "", Buffer.from(`q\n${slide.width} 0 0 ${slide.height} 0 0 cm\n/Im0 Do\nQ`, "latin1")),
      streamObject(
        page + 2,
        `/Type /XObject /Subtype /Image /Width ${slide.width} /Height ${slide.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
        slide.jpeg
      )
    );
  });
  objects.push(dictionaryObject(infoId, `<< /Title ${textString(options.title ?? "")} /Producer (CoLateral Marketing) >>`));

  const offsets: number[] = [];
  let length = HEADER.length;
  for (const object of objects) {
    offsets.push(length);
    length += object.length;
  }
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  const trailer =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  return Buffer.concat([HEADER, ...objects, Buffer.from(trailer, "latin1")]);
}
