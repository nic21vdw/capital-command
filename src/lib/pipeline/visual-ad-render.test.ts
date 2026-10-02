import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { adCanvasSize, type VisualAdFormat } from "@/lib/pipeline/visual-brief";
import {
  defaultVisualAdSettings,
  fitAdText,
  renderVisualAd,
  visualAdLayout,
  visualAdQuality,
} from "@/lib/pipeline/visual-ad-render";

const formats: VisualAdFormat[] = ["portrait", "story", "square", "landscape"];

describe("real-photo ad layout", () => {
  it.each(formats)(
    "preserves the full stream frame in %s, including a face at the top right",
    (format) => {
      const source = createCanvas(1920, 1080);
      const sourceContext = source.getContext("2d");
      sourceContext.fillStyle = "#ffffff";
      sourceContext.fillRect(0, 0, 1920, 1080);
      for (const [x, y, color] of [
        [0, 0, "#ff0000"],
        [1760, 0, "#00ff00"],
        [0, 920, "#0000ff"],
        [1760, 920, "#ffff00"],
      ] as const) {
        sourceContext.fillStyle = color;
        sourceContext.fillRect(x, y, 160, 160);
      }
      const settings = {
        ...defaultVisualAdSettings("I built the working feature live"),
        format,
      };
      const size = adCanvasSize(format);
      const canvas = createCanvas(size.width, size.height);
      const context = canvas.getContext("2d");
      const verdict = renderVisualAd(
        context as unknown as CanvasRenderingContext2D,
        source as unknown as CanvasImageSource,
        { width: 1920, height: 1080 },
        settings,
      );
      expect(verdict.croppedPercent).toBe(0);
      expect(verdict.copyFits).toBe(true);
      const { photo } = verdict;
      const corners = [
        [photo.x + 15, photo.y + 15],
        [photo.x + photo.width - 15, photo.y + 15],
        [photo.x + 15, photo.y + photo.height - 15],
        [photo.x + photo.width - 15, photo.y + photo.height - 15],
      ];
      expect(
        corners.map(([x, y]) =>
          Array.from(
            context.getImageData(Math.round(x), Math.round(y), 1, 1).data,
          ),
        ),
      ).toEqual([
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
      ]);
      expect(photo.y + photo.height).toBeLessThanOrEqual(
        verdict.imageHeight + 0.001,
      );
      const png = canvas.toBuffer("image/png");
      expect(png.readUInt32BE(16)).toBe(size.width);
      expect(png.readUInt32BE(20)).toBe(size.height);
    },
  );

  it("warns about softness from a small photo and manual cropping", () => {
    const settings = {
      ...defaultVisualAdSettings("Real stream"),
      framing: "crop" as const,
    };
    const quality = visualAdQuality({ width: 480, height: 270 }, settings);
    expect(
      quality.warnings.some((warning) => warning.includes("Source enlarged")),
    ).toBe(true);
    expect(
      quality.warnings.some((warning) =>
        warning.includes("of the source is cropped"),
      ),
    ).toBe(true);
    expect(quality.croppedPercent).toBeGreaterThan(0);
  });

  it("uses actual top-right facecam pixels and reports the cropped frame", () => {
    const source = createCanvas(1920, 1080);
    const sourceContext = source.getContext("2d");
    sourceContext.fillStyle = "#00ff00";
    sourceContext.fillRect(0, 0, 1920, 1080);
    sourceContext.fillStyle = "#ff0000";
    sourceContext.fillRect(1325, 0, 595, 346);
    const settings = {
      ...defaultVisualAdSettings("A real reaction, straight from the stream"),
      framing: "facecam" as const,
      focusX: 1,
      focusY: 0,
    };
    const canvas = createCanvas(1080, 1350);
    const context = canvas.getContext("2d");
    const result = renderVisualAd(
      context as unknown as CanvasRenderingContext2D,
      source as unknown as CanvasImageSource,
      { width: 1920, height: 1080 },
      settings,
    );
    expect(Array.from(context.getImageData(540, 300, 1, 1).data)).toEqual([
      255, 0, 0, 255,
    ]);
    expect(result.copyFits).toBe(true);
    expect(result.croppedPercent).toBeGreaterThan(85);
    expect(result.warnings.join(" ")).toContain("cropped");
    expect(result.warnings.join(" ")).toContain("Source enlarged");
    expect(result.sourceCrop.x + result.sourceCrop.width).toBeCloseTo(1920);
  });

  it("refuses unusable image dimensions before drawing", () => {
    expect(() =>
      visualAdLayout(
        { width: 0, height: 100 },
        defaultVisualAdSettings("A hook"),
      ),
    ).toThrow("usable dimensions");
    expect(() =>
      visualAdLayout(
        { width: Infinity, height: 100 },
        defaultVisualAdSettings("A hook"),
      ),
    ).toThrow("usable dimensions");
  });
});

describe("readable ad copy", () => {
  it.each(formats)(
    "fits long copy in %s without quietly dropping words",
    (format) => {
      const canvas = createCanvas(1, 1);
      const context = canvas.getContext("2d");
      const settings = {
        ...defaultVisualAdSettings(
          "I tested the real workflow live, found the part that failed, and rebuilt it into something that actually works",
        ),
        format,
      };
      const size = adCanvasSize(format);
      const target = createCanvas(size.width, size.height);
      const result = renderVisualAd(
        target.getContext("2d") as unknown as CanvasRenderingContext2D,
        canvas as unknown as CanvasImageSource,
        { width: 1920, height: 1080 },
        settings,
      );
      expect(result.copyFits).toBe(true);
      const fitted = fitAdText(
        (text, fontSize) => {
          context.font = `700 ${fontSize}px Arial`;
          return context.measureText(text).width;
        },
        settings.headline,
        size.width - 140,
        300,
        70,
        26,
      );
      expect(fitted.fits).toBe(true);
      expect(fitted.lines.join(" ")).toBe(settings.headline);
    },
  );

  it("flags unbreakable copy instead of exporting a truncated headline", () => {
    const canvas = createCanvas(1080, 1350);
    const source = createCanvas(1920, 1080);
    const result = renderVisualAd(
      canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
      source as unknown as CanvasImageSource,
      { width: 1920, height: 1080 },
      defaultVisualAdSettings("W".repeat(180)),
    );
    expect(result.copyFits).toBe(false);
    expect(result.warnings.join(" ")).toContain("Shorten it before exporting");
  });
});
