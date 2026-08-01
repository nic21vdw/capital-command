import { describe, expect, it } from "vitest";
import { keyOutBackground } from "./bg-removal";

/** Builds a width*height RGBA buffer from a per-pixel color callback. */
function makeImage(
  width: number,
  height: number,
  color: (x: number, y: number) => [number, number, number]
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const [r, g, b] = color(x, y);
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }
  return data;
}

const alphaAt = (data: Uint8ClampedArray, width: number, x: number, y: number) => data[(y * width + x) * 4 + 3];

describe("keyOutBackground", () => {
  it("clears a solid background and keeps the subject opaque", () => {
    const W = 5;
    const H = 5;
    const data = makeImage(W, H, (x, y) => {
      const inSubject = x >= 1 && x <= 3 && y >= 1 && y <= 3;
      return inSubject ? [0, 0, 0] : [255, 255, 255];
    });
    keyOutBackground(data, W, H, 32);

    expect(alphaAt(data, W, 0, 0)).toBe(0);
    expect(alphaAt(data, W, 4, 4)).toBe(0);
    expect(alphaAt(data, W, 2, 2)).toBe(255);
    expect(alphaAt(data, W, 1, 1)).toBe(255);
  });

  it("keeps an enclosed region the background color — the fill starts from the edges", () => {
    const W = 5;
    const H = 5;
    const data = makeImage(W, H, (x, y) => (x === 2 && y === 2 ? [0, 0, 0] : [255, 255, 255]));
    keyOutBackground(data, W, H, 32);

    expect(alphaAt(data, W, 2, 2)).toBe(255);
    expect(alphaAt(data, W, 0, 0)).toBe(0);
  });

  it("stops the fill at a sharp edge beyond tolerance", () => {
    const W = 4;
    const H = 1;
    const data = makeImage(W, H, (x) => (x < 2 ? [255, 255, 255] : [0, 0, 0]));
    keyOutBackground(data, W, H, 10);

    // Seeded from both ends: the whites go from the left and the blacks from the
    // right, since they are border pixels themselves. Tolerance only blocks the
    // fill from crossing the contrast, it does not protect an edge pixel.
    expect(alphaAt(data, W, 0, 0)).toBe(0);
    expect(alphaAt(data, W, 1, 0)).toBe(0);
    expect(alphaAt(data, W, 2, 0)).toBe(0);
    expect(alphaAt(data, W, 3, 0)).toBe(0);
  });

  it("treats a degenerate size as a no-op rather than throwing", () => {
    expect(() => keyOutBackground(new Uint8ClampedArray(0), 0, 0, 32)).not.toThrow();
  });
});
