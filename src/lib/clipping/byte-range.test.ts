import { describe, expect, it } from "vitest";
import { parseByteRange } from "@/lib/clipping/byte-range";

describe("media byte ranges", () => {
  it.each([
    ["bytes=0-1", 100, { start: 0, end: 1 }],
    ["bytes=50-", 100, { start: 50, end: 99 }],
    ["bytes=50-200", 100, { start: 50, end: 99 }],
    ["bytes=-10", 100, { start: 90, end: 99 }],
    ["bytes=-200", 100, { start: 0, end: 99 }],
    [" bytes=0-0 ", 1, { start: 0, end: 0 }],
  ])("resolves %s for a %i-byte media file", (header, size, expected) => {
    expect(parseByteRange(header, size)).toEqual(expected);
  });

  it.each([
    ["bytes=100-", 100], ["bytes=5-2", 100], ["bytes=-0", 100],
    ["bytes=-", 100], ["items=0-2", 100], ["bytes=0-2,4-5", 100],
    ["garbage bytes=0-2", 100], ["bytes=0-2garbage", 100],
    ["bytes=9007199254740992-", 100], ["bytes=0-9007199254740992", 100],
    ["bytes=0-", 0], ["bytes=-1", 0], ["bytes=0-1", -1],
  ])("rejects unusable range %s on a %i-byte file", (header, size) => {
    expect(parseByteRange(header, size)).toBeNull();
  });
});
