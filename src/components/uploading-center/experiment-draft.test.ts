import { describe, expect, it } from "vitest";
import {
  addVariant,
  applySuggestions,
  editVariant,
  experimentRequest,
  readyToStart,
  removeVariant,
  startingVariants
} from "@/components/uploading-center/experiment-draft";

describe("startingVariants", () => {
  it("starts a title test with the current title as variant A and an empty B", () => {
    expect(startingVariants("title", "Agents Are Eating Software")).toEqual([
      { value: "Agents Are Eating Software", origin: "original" },
      { value: "", origin: "edited" }
    ]);
  });

  it("starts a hook test empty, because the caption's opening line is not a field on the card", () => {
    expect(startingVariants("hook", "Agents Are Eating Software")).toEqual([
      { value: "", origin: "original" },
      { value: "", origin: "edited" }
    ]);
  });
});

describe("editing variants", () => {
  const base = startingVariants("title", "Agents Are Eating Software");

  it("marks a changed variant as edited and keeps an unchanged A as the original", () => {
    expect(editVariant(base, 0, "Agents Are Eating Software", "Agents Are Eating Software")[0].origin).toBe("original");
    expect(editVariant(base, 0, "Agents Eat Software", "Agents Are Eating Software")[0]).toEqual({ value: "Agents Eat Software", origin: "edited" });
    expect(editVariant(base, 1, "Why Agents Win", "Agents Are Eating Software")[1]).toEqual({ value: "Why Agents Win", origin: "edited" });
  });

  it("strips line breaks, as the title box does", () => {
    expect(editVariant(base, 1, "Line one\nline two", "x")[1].value).toBe("Line one line two");
  });

  it("adds a third variant but never a fourth, and removes down to two but no further", () => {
    const three = addVariant(base);
    expect(three).toHaveLength(3);
    expect(addVariant(three)).toHaveLength(3);
    expect(removeVariant(three, 2)).toHaveLength(2);
    expect(removeVariant(base, 1)).toHaveLength(2);
  });
});

describe("applySuggestions", () => {
  it("fills the empty slots after A with AI variants, adding a third slot when two come back", () => {
    const filled = applySuggestions(startingVariants("title", "Base Title Words"), ["First Idea Here", "Second Idea Here"]);
    expect(filled).toEqual([
      { value: "Base Title Words", origin: "original" },
      { value: "First Idea Here", origin: "ai" },
      { value: "Second Idea Here", origin: "ai" }
    ]);
  });

  it("does not overwrite a variant the person already wrote", () => {
    const written = editVariant(startingVariants("title", "Base Title Words"), 1, "My own idea", "Base Title Words");
    const filled = applySuggestions(written, ["First Idea Here", "Second Idea Here"]);
    expect(filled[1]).toEqual({ value: "My own idea", origin: "edited" });
    expect(filled[2]).toEqual({ value: "First Idea Here", origin: "ai" });
  });
});

describe("readyToStart", () => {
  const two = [
    { value: "Agents Are Eating Software", origin: "original" as const },
    { value: "Why Every App Needs An Agent Now", origin: "ai" as const }
  ];

  it("is ready with two written variants and a platform", () => {
    expect(readyToStart("title", two, ["youtube"])).toEqual({ ok: true });
  });

  it("is not ready while a variant is blank", () => {
    expect(readyToStart("title", [two[0], { value: " ", origin: "edited" }], ["youtube"])).toMatchObject({ ok: false, reason: expect.stringMatching(/two/i) });
  });

  it("is not ready without a platform, and says why a hook test cannot include YouTube", () => {
    expect(readyToStart("title", two, [])).toMatchObject({ ok: false, reason: expect.stringMatching(/platform/i) });
    expect(readyToStart("hook", two, ["youtube", "instagram"])).toMatchObject({ ok: false, reason: expect.stringMatching(/YouTube/) });
    expect(readyToStart("hook", two, ["instagram", "tiktok"])).toEqual({ ok: true });
  });
});

describe("experimentRequest", () => {
  it("carries the clip, the draft's words and only the written variants", () => {
    const body = experimentRequest({
      kind: "title",
      clip: { jobId: "job1", clipId: "clip1", file: "clip.mp4", headline: "Agents" },
      draft: { title: "Agents Are Eating Software", caption: "Body." },
      variants: [
        { value: " Agents Are Eating Software ", origin: "original" },
        { value: "Why Every App Needs An Agent Now", origin: "ai" },
        { value: "", origin: "edited" }
      ],
      platforms: ["youtube", "instagram"],
      accountIds: { youtube: "youtube-primary", instagram: "instagram-primary", tiktok: "tiktok-primary", facebook: "facebook-primary" }
    });
    expect(body).toEqual({
      kind: "title",
      jobId: "job1",
      clipId: "clip1",
      file: "clip.mp4",
      sourceLabel: "Agents",
      baseTitle: "Agents Are Eating Software",
      baseCaption: "Body.",
      variants: [
        { value: "Agents Are Eating Software", origin: "original" },
        { value: "Why Every App Needs An Agent Now", origin: "ai" }
      ],
      platforms: ["youtube", "instagram"],
      accountIds: { youtube: "youtube-primary", instagram: "instagram-primary" }
    });
  });

  it("leaves a blank caption out so the server writes the same one for every variant", () => {
    const body = experimentRequest({
      kind: "title",
      clip: { jobId: "job1", clipId: "clip1", file: "clip.mp4", headline: "Agents" },
      draft: { title: "Agents Are Eating Software", caption: "  " },
      variants: [
        { value: "One two three", origin: "original" },
        { value: "Four five six", origin: "edited" }
      ],
      platforms: ["instagram"],
      accountIds: { instagram: "instagram-primary" }
    });
    expect(body).not.toHaveProperty("baseCaption");
  });
});
