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
  it("clears a solid background and keeps the subject", () => {
    const data = makeImage(5, 5, (x, y) => {
      const inSubject = x >= 1 && x <= 3 && y >= 1 && y <= 3;
      return inSubject ? [0, 0, 0] : [255, 255, 255];
    });
    keyOutBackground(data, 5, 5, 32);

    expect(alphaAt(data, 5, 0, 0)).toBe(0);
    expect(alphaAt(data, 5, 4, 4)).toBe(0);
    expect(alphaAt(data, 5, 2, 2)).toBe(255);
    expect(alphaAt(data, 5, 1, 1)).toBe(255);
  });

  it("keeps an enclosed region the fill cannot reach from an edge", () => {
    const data = makeImage(5, 5, (x, y) => (x === 2 && y === 2 ? [0, 0, 0] : [255, 255, 255]));
    keyOutBackground(data, 5, 5, 32);

    expect(alphaAt(data, 5, 2, 2)).toBe(255);
    expect(alphaAt(data, 5, 0, 0)).toBe(0);
  });

  it("removes both sides of a sharp edge when both are border pixels", () => {
    // [white, white, black, black] in a row, seeded from both ends. The
    // contrast only blocks the fill from crossing, not from starting.
    const data = makeImage(4, 1, (x) => (x < 2 ? [255, 255, 255] : [0, 0, 0]));
    keyOutBackground(data, 4, 1, 10);

    expect([0, 1, 2, 3].map((x) => alphaAt(data, 4, x, 0))).toEqual([0, 0, 0, 0]);
  });

  it("treats a degenerate size as a no-op rather than throwing", () => {
    expect(() => keyOutBackground(new Uint8ClampedArray(0), 0, 0, 32)).not.toThrow();
  });
});
