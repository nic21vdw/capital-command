import { describe, expect, it } from "vitest";
import { brandPromptBlock } from "@/lib/brand/kit";
import { replyVoiceBlock } from "@/lib/inbox/voice";

describe("the retained inbox voice API", () => {
  it("uses the centralized brand voice without a second set of rules", () => {
    expect(replyVoiceBlock()).toBe(brandPromptBlock("threads"));
  });
});
