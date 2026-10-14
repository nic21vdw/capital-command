import { describe, expect, it } from "vitest";
import { isPostCode, postCode } from "@/lib/attribution/code";

describe("postCode", () => {
  it("is six lowercase letters and digits", () => {
    expect(postCode("clip-1699999999999-abc")).toMatch(/^[a-z0-9]{6}$/);
  });

  it("is the same for the same id every time", () => {
    expect(postCode("post-1")).toBe(postCode("post-1"));
  });

  it("differs between ids", () => {
    const codes = new Set(Array.from({ length: 500 }, (_, i) => postCode(`threads-2026-10-13-${i}`)));
    expect(codes.size).toBe(500);
  });

  it("does not contain the id it was made from", () => {
    expect(postCode("abcdef")).not.toBe("abcdef");
  });
});

describe("isPostCode", () => {
  it("accepts what postCode makes and nothing looser", () => {
    expect(isPostCode(postCode("x"))).toBe(true);
    expect(isPostCode("A3F9C2")).toBe(false);
    expect(isPostCode("a3f9c")).toBe(false);
    expect(isPostCode("a3f9c2d")).toBe(false);
    expect(isPostCode("a3f9-2")).toBe(false);
    expect(isPostCode(undefined)).toBe(false);
  });
});
