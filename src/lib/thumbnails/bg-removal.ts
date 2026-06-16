/**
 * Lightweight, dependency-free background removal for thumbnail subjects.
 *
 * It flood-fills inward from the image borders, turning any region that is
 * connected to an edge and stays within a color tolerance transparent. This
 * cleanly lifts solid or softly graded studio backdrops off a centered subject
 * without needing an ML model or network access. The pixel routine is pure so it
 * can be unit tested; `removeImageBackground` is the browser wrapper.
 */

/**
 * Mutates `data` (RGBA, length = width*height*4) in place, setting the alpha of
 * edge-connected background pixels to 0.
 *
 * @param tolerance Squared-distance leniency per channel step. Higher removes
 *   more (handles gradients); lower preserves more of the subject.
 */
export function keyOutBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 32
): void {
  if (width <= 0 || height <= 0) return;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const tol2 = tolerance * tolerance;

  const seed = (x: number, y: number) => {
    const idx = y * width + x;
    if (!visited[idx]) {
      visited[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }

  while (stack.length > 0) {
    const idx = stack.pop() as number;
    const p = idx * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    data[p + 3] = 0; // background → transparent

    const x = idx % width;
    const y = (idx - x) / width;
    // Region-grow to 4-connected neighbours within tolerance of THIS pixel, so
    // smooth gradients are followed while hard subject edges stop the fill.
    const neighbours = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nidx = ny * width + nx;
      if (visited[nidx]) continue;
      const np = nidx * 4;
      const dr = data[np] - r;
      const dg = data[np + 1] - g;
      const db = data[np + 2] - b;
      if (dr * dr + dg * dg + db * db <= tol2) {
        visited[nidx] = 1;
        stack.push(nidx);
      }
    }
  }
}

/**
 * Returns a new image with the background keyed out. Runs entirely in the
 * browser via a canvas; never touches the network.
 */
export async function removeImageBackground(
  image: HTMLImageElement,
  tolerance = 32
): Promise<HTMLImageElement> {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not supported in this browser.");

  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  keyOutBackground(imageData.data, width, height, tolerance);
  ctx.putImageData(imageData, 0, 0);

  const output = new Image();
  await new Promise<void>((resolve, reject) => {
    output.onload = () => resolve();
    output.onerror = () => reject(new Error("Could not re-decode the cut-out image."));
    output.src = canvas.toDataURL("image/png");
  });
  return output;
}
