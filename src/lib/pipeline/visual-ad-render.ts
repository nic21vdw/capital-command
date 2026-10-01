import {
  adCanvasSize,
  fitCover,
  type VisualAdFormat,
} from "@/lib/pipeline/visual-brief";

export type VisualAdSettings = {
  format: VisualAdFormat;
  framing: "complete" | "crop" | "facecam";
  focusX: number;
  focusY: number;
  treatment: "original" | "natural";
  headline: string;
  brand: string;
  callToAction: string;
};

export type VisualAdImage = { width: number; height: number };

export function defaultVisualAdSettings(headline: string): VisualAdSettings {
  return {
    format: "portrait",
    framing: "complete",
    focusX: 0.5,
    focusY: 0.5,
    treatment: "original",
    headline,
    brand: "Nic Vandewetering",
    callToAction: "Watch the full stream",
  };
}

export function visualAdLayout(
  image: VisualAdImage,
  settings: VisualAdSettings,
) {
  if (
    ![image.width, image.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new Error("The source image has no usable dimensions.");
  }
  const { width, height } = adCanvasSize(settings.format);
  const padding = Math.round(Math.min(width, height) * 0.065);
  const copyHeight = Math.round(
    height * (settings.format === "story" ? 0.32 : 0.38),
  );
  const imageHeight =
    settings.framing === "complete"
      ? Math.min(
          height - copyHeight,
          Math.max(height * 0.46, (width * image.height) / image.width),
        )
      : height - copyHeight;
  const sourceCrop =
    settings.framing === "facecam"
      ? {
          x: image.width * 0.69 * Math.max(0, Math.min(1, settings.focusX)),
        y: image.height * 0.69 * Math.max(0, Math.min(1, settings.focusY)),
          width: image.width * 0.31,
        height: image.height * 0.31,
        }
      : { x: 0, y: 0, width: image.width, height: image.height };
  const completeScale = Math.min(
    width / sourceCrop.width,
    imageHeight / sourceCrop.height,
  );
  const photo =
    settings.framing !== "complete"
      ? fitCover(
          sourceCrop.width,
          sourceCrop.height,
          width,
          imageHeight,
          settings.framing === "facecam" ? 0.5 : settings.focusX,
          settings.framing === "facecam" ? 0.5 : settings.focusY,
        )
      : {
          x: (width - image.width * completeScale) / 2,
          y: (imageHeight - image.height * completeScale) / 2,
          width: image.width * completeScale,
          height: image.height * completeScale,
        };
  const visibleFraction =
    ((sourceCrop.width * sourceCrop.height) / (image.width * image.height)) *
    Math.min(1, width / photo.width) *
    Math.min(1, imageHeight / photo.height);
  return {
    width,
    height,
    padding,
    copyHeight: height - imageHeight,
    imageHeight,
    photo,
    sourceCrop,
    scale: photo.width / sourceCrop.width,
    croppedPercent: Math.round((1 - visibleFraction) * 100),
  };
}

export function visualAdQuality(
  image: VisualAdImage,
  settings: VisualAdSettings,
) {
  const layout = visualAdLayout(image, settings);
  const warnings: string[] = [];
  if (layout.scale > 1.25)
    warnings.push(
      `Source enlarged ${layout.scale.toFixed(1)}x. Use a higher-resolution original for sharper export.`,
    );
  if (layout.croppedPercent > 0)
    warnings.push(
      `${layout.croppedPercent}% of the source is cropped. Check Nic's face, hands and the screen, or choose Complete frame.`,
    );
  if (!settings.headline.trim())
    warnings.push("Add a headline grounded in the selected stream moment.");
  return { ...layout, warnings };
}

export function fitAdText(
  measure: (text: string, size: number) => number,
  text: string,
  width: number,
  height: number,
  preferredSize: number,
  minimumSize: number,
) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (let size = preferredSize; size >= minimumSize; size -= 2) {
    const lines: string[] = [];
    let line = "";
    let fits = true;
    for (const word of words) {
      if (measure(word, size) > width) {
        fits = false;
        break;
      }
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size) <= width) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (fits && lines.length * size * 1.14 <= height)
      return { lines, size, fits: true };
  }
  return { lines: [], size: minimumSize, fits: false };
}

export function renderVisualAd(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  dimensions: VisualAdImage,
  settings: VisualAdSettings,
) {
  const layout = visualAdQuality(dimensions, settings);
  const { width, height, imageHeight, padding, photo } = layout;
  context.save();
  context.fillStyle = "#0c1018";
  context.fillRect(0, 0, width, height);
  context.save();
  context.beginPath();
  context.rect(0, 0, width, imageHeight);
  context.clip();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter =
    settings.treatment === "natural"
      ? "brightness(1.03) contrast(1.04) saturate(0.98)"
      : "none";
  context.drawImage(
    image,
    layout.sourceCrop.x,
    layout.sourceCrop.y,
    layout.sourceCrop.width,
    layout.sourceCrop.height,
    photo.x,
    photo.y,
    photo.width,
    photo.height,
  );
  context.restore();

  context.textBaseline = "top";
  const textWidth = width - padding * 2;
  const brandSize = Math.round(width * 0.023);
  const ctaSize = Math.round(width * 0.025);
  const brandY = imageHeight + padding * 0.6;
  const headlineY = brandY + brandSize + padding * 0.45;
  const ctaY = height - padding - ctaSize;
  const measure = (text: string, size: number) => {
    context.font = `700 ${size}px Arial, sans-serif`;
    return context.measureText(text).width;
  };
  const headline = fitAdText(
    measure,
    settings.headline,
    textWidth,
    ctaY - headlineY - padding * 0.4,
    Math.round(Math.min(width * 0.09, layout.copyHeight * 0.24)),
    Math.round(width * 0.028),
  );
  const brand = fitAdText(
    measure,
    settings.brand,
    textWidth,
    brandSize * 1.15,
    brandSize,
    Math.round(width * 0.016),
  );
  const cta = fitAdText(
    measure,
    settings.callToAction,
    textWidth,
    ctaSize * 1.15,
    ctaSize,
    Math.round(width * 0.016),
  );
  context.fillStyle = "#92e8d0";
  context.fillRect(padding, imageHeight, Math.round(width * 0.13), 5);
  context.font = `700 ${brand.size}px Arial, sans-serif`;
  if (brand.fits) context.fillText(brand.lines[0] ?? "", padding, brandY);
  context.fillStyle = "#ffffff";
  context.font = `700 ${headline.size}px Arial, sans-serif`;
  headline.lines.forEach((line, index) =>
    context.fillText(line, padding, headlineY + index * headline.size * 1.14),
  );
  context.fillStyle = "#c5cbd5";
  context.font = `700 ${cta.size}px Arial, sans-serif`;
  if (cta.fits) context.fillText(cta.lines[0] ?? "", padding, ctaY);
  context.restore();
  const warnings = [...layout.warnings];
  if (!headline.fits || !brand.fits || !cta.fits)
    warnings.push(
      "The copy does not fit. Shorten it before exporting; no words have been silently cut off.",
    );
  return {
    ...layout,
    warnings,
    copyFits: headline.fits && brand.fits && cta.fits,
  };
}
