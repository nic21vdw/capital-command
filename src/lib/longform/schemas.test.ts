import { describe, expect, it } from "vitest";
import { longformCreateSchema } from "./schemas";

// A project can start from an uploaded source OR a pasted video URL, but never
// both and never neither — the route relies on this to pick which pipeline to
// run.
describe("longformCreateSchema", () => {
  it("accepts an uploaded source id", () => {
    const result = longformCreateSchema.safeParse({ sourceId: "abc123" });
    expect(result.success).toBe(true);
  });

  it("accepts a video url", () => {
    const result = longformCreateSchema.safeParse({ url: "https://youtube.com/watch?v=xyz" });
    expect(result.success).toBe(true);
  });

  it("rejects a non-URL string in the url field", () => {
    const result = longformCreateSchema.safeParse({ url: "not a link" });
    expect(result.success).toBe(false);
  });

  it("rejects a body with neither a source nor a url", () => {
    const result = longformCreateSchema.safeParse({ name: "My video" });
    expect(result.success).toBe(false);
  });

  it("rejects a body that supplies both a source and a url", () => {
    const result = longformCreateSchema.safeParse({
      sourceId: "abc123",
      url: "https://youtube.com/watch?v=xyz"
    });
    expect(result.success).toBe(false);
  });
});
