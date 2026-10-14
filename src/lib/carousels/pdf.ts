import { PDFDocument, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

const JPEG_QUALITY = 88;

export type CarouselPdfOptions = {
  title?: string;
};

export async function buildCarouselPdf(imagePaths: string[], options: CarouselPdfOptions = {}): Promise<Buffer> {
  if (imagePaths.length === 0) throw new Error("A PDF carousel needs at least one slide.");
  const document = new PDFDocument({
    title: options.title,
    creator: "CoLateral Marketing",
    rasterDPI: 72,
    encodingQuality: JPEG_QUALITY
  });
  for (const imagePath of imagePaths) {
    const image = await loadImage(imagePath);
    const context = document.beginPage(image.width, image.height) as unknown as SKRSContext2D;
    context.drawImage(image, 0, 0, image.width, image.height);
    document.endPage();
  }
  return document.close();
}
