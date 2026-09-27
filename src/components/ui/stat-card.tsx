import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import type { BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "",
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
  info: "tone-info",
  accent: "tone-accent"
};

/**
 * `tone` colours the icon chip, and only that. A stat is a number, so the tile
 * stays quiet by default (accent) - the tone is for the one tile on a page that
 * is reporting a problem, where a warning triangle rendered in the same blue as
 * every other icon says nothing. It follows the theme like the rest of the
 * status vocabulary (globals.css, "Status tones").
 */
export function StatCard({
  label,
  value,
  detail,
  icon,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
  tone?: BadgeTone;
}) {
  const toned = tone !== "neutral";
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
          {detail ? <p className="mt-2 text-sm text-[var(--muted-foreground)]">{detail}</p> : null}
        </div>
        {icon ? (
          <div
            className={cn(
              "rounded-lg p-3",
              toned
                ? "bg-[color-mix(in_srgb,var(--tone)_14%,transparent)] text-[var(--tone)]"
                : "bg-white/6 text-[var(--accent)]",
              toned && TONE_CLASS[tone]
            )}
          >
            {icon}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
