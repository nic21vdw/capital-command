import { brandPromptBlock } from "@/lib/brand/kit";

/** Preserve the existing prompt API while the brand kit owns the voice rules. */
export function replyVoiceBlock(): string {
  return brandPromptBlock("threads");
}
