"use client";

import { useState } from "react";
import { FlaskConical, Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  addVariant,
  applySuggestions,
  editVariant,
  experimentRequest,
  readyToStart,
  removeVariant,
  startingVariants,
  type DraftKind,
  type DraftVariant
} from "@/components/uploading-center/experiment-draft";
import { PLATFORM_LABELS, schedulePlatforms, type ClipDraft, type ReadyClip } from "@/components/uploading-center/use-uploading-center";
import { DEFAULT_WINDOW_HOURS, MAX_HOOK_LENGTH, MAX_TITLE_LENGTH, MAX_VARIANTS, VARIANT_IDS } from "@/lib/experiments/types";
import { VARIANT_GAP_MS } from "@/lib/experiments/spacing";
import type { PlatformId } from "@/lib/publisher/types";
import { cn } from "@/lib/utils";

export type ExperimentContext = {
  accountIds: Record<PlatformId, string>;
  disabledReason?: string;
  onBooked: () => void | Promise<void>;
};

const KIND_LABEL: Record<DraftKind, string> = { title: "Title", hook: "Hook" };

const KIND_HINT: Record<DraftKind, string> = {
  title: "Each variant is the post's title. The caption and hashtags stay the same.",
  hook: "Each variant is the opening line of the caption. The title stays the same."
};

export function ExperimentToggle({ open, onToggle, disabledReason }: { open: boolean; onToggle: () => void; disabledReason?: string }) {
  return (
    <Button
      variant="secondary"
      onClick={onToggle}
      disabled={Boolean(disabledReason) && !open}
      aria-expanded={open}
      className="h-8 shrink-0 px-2.5 text-xs"
      title={disabledReason ?? "Post this clip with 2 or 3 different titles or hooks, and find out which one does better"}
    >
      <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
      Test titles
    </Button>
  );
}

export function ExperimentPanel({
  clip,
  draft,
  context,
  onClose
}: {
  clip: ReadyClip;
  draft: ClipDraft;
  context: ExperimentContext;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<DraftKind>("title");
  const [variants, setVariants] = useState<DraftVariant[]>(() => startingVariants("title", draft.title));
  const [suggesting, setSuggesting] = useState(false);
  const [starting, setStarting] = useState(false);
  const platforms = schedulePlatforms(draft.platform);
  const readiness = readyToStart(kind, variants, platforms);
  const limit = kind === "title" ? MAX_TITLE_LENGTH : MAX_HOOK_LENGTH;

  const chooseKind = (next: DraftKind) => {
    if (next === kind) return;
    setKind(next);
    setVariants(startingVariants(next, draft.title));
  };

  const suggest = async () => {
    const base = (kind === "title" ? variants[0]?.value || draft.title : variants[0]?.value || draft.caption).trim().slice(0, limit);
    if (!base) {
      toast.info(kind === "title" ? "Write variant A first, then ask for ideas." : "Write the opening line for variant A first, then ask for ideas.");
      return;
    }
    setSuggesting(true);
    try {
      const response = await fetch("/api/experiments/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: clip.jobId, clipId: clip.clipId, kind, base, count: MAX_VARIANTS - 1 })
      });
      const body = (await response.json().catch(() => ({}))) as { variants?: string[] | null; note?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      if (!body.variants) {
        toast.info(body.note ?? "No model answered, so type the variants yourself.");
        return;
      }
      setVariants((current) => applySuggestions(current, body.variants!));
    } catch (error) {
      toast.error(`Could not get ideas: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSuggesting(false);
    }
  };

  const start = async () => {
    if (!readiness.ok) return;
    setStarting(true);
    try {
      const response = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(experimentRequest({ kind, clip, draft, variants, platforms, accountIds: context.accountIds }))
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; booked?: Array<{ id: string; publishAt: string }> };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      const days = [...new Set((body.booked ?? []).map((item) => item.publishAt.slice(0, 10)))].length;
      toast.success(`Test booked: ${body.booked?.length ?? 0} posts over ${days} days. Results appear on Performance ${DEFAULT_WINDOW_HOURS} hours after each one goes out.`);
      await context.onBooked();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--well)] p-3" role="group" aria-label="Test titles">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" role="group" aria-label="What to test">
          {(Object.keys(KIND_LABEL) as DraftKind[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => chooseKind(option)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition max-sm:min-h-10",
                kind === option
                  ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-white/10 hover:text-white"
              )}
            >
              {KIND_LABEL[option]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Close the test" className="text-[var(--muted-foreground)] hover:text-white max-sm:min-h-10 max-sm:min-w-10">
          <X className="mx-auto h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{KIND_HINT[kind]}</p>
      <div className="space-y-2">
        {variants.map((variant, index) => (
          <div key={VARIANT_IDS[index]} className="flex items-start gap-2">
            <span className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white">{VARIANT_IDS[index]}</span>
            <Textarea
              value={variant.value}
              maxLength={limit}
              rows={1}
              onChange={(event) => setVariants((current) => editVariant(current, index, event.target.value, kind === "title" ? draft.title : ""))}
              placeholder={kind === "title" ? `Title ${VARIANT_IDS[index]}` : `Opening line ${VARIANT_IDS[index]}`}
              aria-label={`Variant ${VARIANT_IDS[index]}`}
              className="field-sizing-content min-h-9 min-w-0 flex-1 resize-none py-2"
            />
            {variant.origin === "ai" ? <span className="mt-2 shrink-0 text-[11px] text-[var(--muted-foreground)]">AI</span> : null}
            {index >= 2 ? (
              <button
                type="button"
                onClick={() => setVariants((current) => removeVariant(current, index))}
                aria-label={`Remove variant ${VARIANT_IDS[index]}`}
                className="mt-2 shrink-0 text-[var(--muted-foreground)] hover:text-white max-sm:min-h-10 max-sm:min-w-10"
              >
                <X className="mx-auto h-4 w-4" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {variants.length < MAX_VARIANTS ? (
          <Button variant="ghost" onClick={() => setVariants(addVariant)} className="h-8 px-2.5 text-xs">
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add a third
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => void suggest()} disabled={suggesting} className="h-8 px-2.5 text-xs">
          {suggesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          {suggesting ? "Thinking..." : "Suggest with AI"}
        </Button>
      </div>
      <p className="text-[11px] text-[var(--muted-foreground)]">
        {platforms.map((platform) => PLATFORM_LABELS[platform]).join(", ") || "No platform chosen"}: each variant goes out as its own post on every one of those, at least{" "}
        {VARIANT_GAP_MS / 3_600_000} hours apart. Each is scored {DEFAULT_WINDOW_HOURS} hours after it posts, against what your account normally gets on that platform. Nothing is tested
        unless you start it here.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void start()} disabled={!readiness.ok || starting} className="h-9 px-3">
          {starting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-1.5 h-4 w-4" />}
          Start test
        </Button>
        {!readiness.ok ? <p className="text-xs text-[var(--muted-foreground)]">{readiness.reason}</p> : null}
      </div>
    </div>
  );
}
