"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The one way a screen hides its knobs.
 *
 * Every Formats screen greeted a first-time user with every option it has at
 * once — five source kinds, batch counts, aspect ratios, per-platform accounts
 * — so there was no visible "just do the normal thing" path. The fix is not to
 * remove options: it is to show ONE primary action and put the rest behind
 * this, closed by default, with a summary line so what is hidden is never a
 * surprise.
 *
 * Nothing here may be the only way to reach a setting the primary path needs.
 * Closed must always mean "the defaults in the summary apply", never "you
 * cannot get there".
 */
export function AdvancedOptions({
  id,
  summary,
  label = "Customise",
  children,
  className
}: {
  /** Stable key — the open/closed choice is remembered per screen. */
  id: string;
  /** What the current settings are, read at a glance while closed. */
  summary: string;
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const storageKey = `capital-command:advanced:${id}`;

  // Read after mount, off the render pass: reading localStorage in the state
  // initializer makes the client's first render disagree with the server HTML.
  useEffect(() => {
    queueMicrotask(() => {
      try {
        if (window.localStorage.getItem(storageKey) === "1") setOpen(true);
      } catch {
        // Non-critical preference read.
      }
    });
  }, [storageKey]);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Non-critical preference persistence.
      }
      return next;
    });
  };

  return (
    <div className={cn("rounded-lg border border-[var(--border)] bg-[var(--well)]", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--muted-foreground)] transition hover:text-white"
      >
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
        <span className="shrink-0 font-medium">{label}</span>
        {/* The summary is what makes hiding these safe: closed still says what
            they are set to, so nothing is a surprise at export time. */}
        <span className="min-w-0 flex-1 truncate text-right text-xs">{open ? "" : summary}</span>
      </button>
      {open && <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">{children}</div>}
    </div>
  );
}
