import { describe, expect, it } from "vitest";
import { artworkProblems, readImageSize } from "@/lib/podcast/artwork";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** SOI, an APP0 segment to walk past, then an SOF0 frame header. */
function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  bytes.set([0xff, 0xd8], 0);
  bytes.set([0xff, 0xe0], 2);
  view.setUint16(4, 8);
  bytes.set([0xff, 0xc0], 12);
  view.setUint16(14, 17);
  bytes[16] = 8;
  view.setUint16(17, height);
  view.setUint16(19, width);
  return bytes;
}

describe("readImageSize", () => {
  it("reads a PNG header", () => {
    expect(readImageSize(png(1600, 1600))).toEqual({ width: 1600, height: 1600, format: "png" });
  });

  it("walks past a JPEG's other segments to the frame header", () => {
    expect(readImageSize(jpeg(2000, 1500))).toEqual({ width: 2000, height: 1500, format: "jpeg" });
  });

  it("returns null for something that is not an image", () => {
    expect(readImageSize(new TextEncoder().encode("not an image at all"))).toBeNull();
  });
});

describe("artworkProblems", () => {
  it("accepts a square image inside Spotify's range", () => {
    expect(artworkProblems(readImageSize(png(1600, 1600)))).toEqual([]);
  });

  it("rejects a non-square image", () => {
    expect(artworkProblems(readImageSize(png(1600, 900))).join(" ")).toContain("square");
  });

  it("rejects one that is too small", () => {
    expect(artworkProblems(readImageSize(png(500, 500))).join(" ")).toContain("at least 1400px");
  });

  it("rejects one that is too large", () => {
    expect(artworkProblems(readImageSize(png(4000, 4000))).join(" ")).toContain("at most 3000px");
  });

  it("rejects a file it cannot read at all", () => {
    expect(artworkProblems(null)).toEqual(["Cover art must be a PNG or JPEG image."]);
  });
});
