import { describe, expect, it } from "vitest";
import { signInVerifiable } from "./connections";

describe("signInVerifiable", () => {
  it("is true only for platforms whose sign-in mints the token", () => {
    expect(signInVerifiable("youtube")).toBe(true);
    expect(signInVerifiable("tiktok")).toBe(true);
  });

  it("is false for pasted-token platforms and unknown ids", () => {
    for (const id of ["instagram", "facebook", "threads", "nope"]) expect(signInVerifiable(id)).toBe(false);
  });
});
