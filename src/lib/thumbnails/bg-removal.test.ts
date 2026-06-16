import assert from "node:assert/strict";
import { keyOutBackground } from "./bg-removal";

/** Builds a width*height RGBA buffer from a per-pixel color callback. */
function makeImage(width: number, height: number, color: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
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

// A solid white background with a black square subject in the middle: the
// background goes transparent, the subject stays opaque.
{
  const W = 5;
  const Hgt = 5;
  const data = makeImage(W, Hgt, (x, y) => {
    const inSubject = x >= 1 && x <= 3 && y >= 1 && y <= 3;
    return inSubject ? [0, 0, 0] : [255, 255, 255];
  });
  keyOutBackground(data, W, Hgt, 32);

  // Corners (background) are now transparent.
  assert.equal(alphaAt(data, W, 0, 0), 0);
  assert.equal(alphaAt(data, W, 4, 4), 0);
  // Subject center is preserved.
  assert.equal(alphaAt(data, W, 2, 2), 255);
  assert.equal(alphaAt(data, W, 1, 1), 255);
}

// An interior region with the same color as the subject but NOT connected to an
// edge must survive — flood fill only removes edge-connected background.
{
  const W = 5;
  const Hgt = 5;
  // Everything white except a single fully enclosed black pixel at center.
  const data = makeImage(W, Hgt, (x, y) => (x === 2 && y === 2 ? [0, 0, 0] : [255, 255, 255]));
  keyOutBackground(data, W, Hgt, 32);
  assert.equal(alphaAt(data, W, 2, 2), 255); // enclosed pixel kept
  assert.equal(alphaAt(data, W, 0, 0), 0); // surrounding white removed
}

// Tolerance gates removal: a sharp edge beyond tolerance stops the fill.
{
  const W = 4;
  const Hgt = 1;
  // [white, white, black, black] in a row, seeded from both ends.
  const data = makeImage(W, Hgt, (x) => (x < 2 ? [255, 255, 255] : [0, 0, 0]));
  keyOutBackground(data, W, Hgt, 10);
  // From the left, both whites removed; from the right, both blacks removed too
  // (they are themselves border pixels). The contrast only blocks crossing.
  assert.equal(alphaAt(data, W, 0, 0), 0);
  assert.equal(alphaAt(data, W, 1, 0), 0);
  assert.equal(alphaAt(data, W, 2, 0), 0);
  assert.equal(alphaAt(data, W, 3, 0), 0);
}

// Degenerate sizes are no-ops rather than throwing.
keyOutBackground(new Uint8ClampedArray(0), 0, 0, 32);

console.log("thumbnails/bg-removal.test.ts passed");
