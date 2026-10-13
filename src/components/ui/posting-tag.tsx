import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * What pressing "Schedule" on a screen really does, in one word. Every place
 * that books, saves or drafts a post wears one of these so the same word means
 * the same thing everywhere (the Distribution Centre carries the legend).
 */
export type PostingMode = "automatic" | "reminder" | "copy-only" | "manual";

export const POSTING_MODES: Record<PostingMode, { label: string; tone: BadgeTone; meaning: string }> = {
  automatic: {
    label: "Automatic",
    tone: "success",
    meaning: "Booked in the publish queue. It posts itself at the time you pick."
  },
  reminder: {
    label: "Reminder",
    tone: "warning",
    meaning: "Saves a reminder on the calendar. Nothing posts; you post it."
  },
  "copy-only": {
    label: "Copy-only",
    tone: "info",
    meaning: "The app writes the text. You copy it and post it yourself."
  },
  manual: {
    label: "Post by hand",
    tone: "neutral",
    meaning: "Nothing is sent or booked for you. You post it yourself."
  }
};

export function PostingTag({ mode, className, title }: { mode: PostingMode; className?: string; title?: string }) {
  const entry = POSTING_MODES[mode];
  return (
    <Badge tone={entry.tone} title={title ?? entry.meaning} className={cn("px-2 py-0.5 text-[10px]", className)}>
      {entry.label}
    </Badge>
  );
}
