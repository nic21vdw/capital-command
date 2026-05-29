"use client";

import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { prettyDateTime } from "@/lib/progress/date-utils";

function formatHMS(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
}

export function SessionTimer({
  active,
  startTime,
  elapsedSeconds,
  onStart,
  onEnd
}: {
  active: boolean;
  startTime: string | null;
  elapsedSeconds: number;
  onStart: () => void;
  onEnd: () => void;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(213,255,127,0.4), transparent 60%)" }}
      />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">
            {active ? "Founder mode engaged" : "Session timer"}
          </p>
          <p
            className="mt-3 font-semibold text-white"
            style={{ fontSize: "clamp(2.5rem, 6vw, 4rem)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}
          >
            {formatHMS(elapsedSeconds)}
          </p>
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            {active && startTime
              ? `Started ${prettyDateTime(startTime)}`
              : "Hit start when you sit down to build."}
          </p>
        </div>
        <div className="flex gap-2 sm:flex-col">
          {active ? (
            <Button variant="danger" onClick={onEnd} className="gap-2 px-6 py-3 text-base">
              <Square className="h-4 w-4" />
              End Session
            </Button>
          ) : (
            <Button variant="primary" onClick={onStart} className="gap-2 px-6 py-3 text-base">
              <Play className="h-4 w-4" />
              Start Session
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
