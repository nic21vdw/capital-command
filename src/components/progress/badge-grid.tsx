"use client";

import { Award } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Badge } from "@/types/progress";

export function BadgeGrid({ badges }: { badges: Badge[] }) {
  const unlocked = badges.filter((b) => b.unlocked).length;
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">Milestones</p>
          <p className="mt-2 text-lg font-semibold text-white">Badges</p>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          {unlocked} / {badges.length} unlocked
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {badges.map((badge) => (
          <div
            key={badge.id}
            className={cn(
              "rounded-2xl border p-3 text-left transition",
              badge.unlocked
                ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 shadow-[0_0_24px_rgba(213,255,127,0.18)]"
                : "border-white/8 bg-black/20 opacity-60"
            )}
          >
            <div className="mb-2 inline-flex rounded-xl bg-white/6 p-2 text-[var(--accent)]">
              <Award className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium text-white">{badge.label}</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{badge.description}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
