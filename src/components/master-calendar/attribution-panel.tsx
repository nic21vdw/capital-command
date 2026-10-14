"use client";

import { useEffect, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { AttributionSlug } from "@/lib/attribution/readback";
import { formatRevenue, type AttributionLine, type AttributionTotals } from "@/lib/attribution/view";

type PanelState =
  | { status: "disabled" }
  | { status: "unavailable"; message: string }
  | { status: "ok"; lines: AttributionLine[]; totals: AttributionTotals };

const REFRESH_MS = 5 * 60_000;
const TOP_LINES = 8;
const PLATFORM_NAMES: Record<AttributionSlug, string> = {
  yt: "YouTube",
  ig: "Instagram",
  tt: "TikTok",
  fb: "Facebook",
  th: "Threads",
  x: "X"
};

function lineName(line: AttributionLine): string {
  if (line.label) return line.label;
  return line.code ? `Post ${line.code}` : "Link without a post code";
}

export function AttributionPanel() {
  const [state, setState] = useState<PanelState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      let next: PanelState | null = null;
      try {
        const response = await fetch("/api/attribution?days=7", { cache: "no-store" });
        if (response.ok) next = (await response.json()) as PanelState;
      } catch {
        next = null;
      }
      if (cancelled) return;
      if (next) setState(next);
      timer = setTimeout(() => void load(), REFRESH_MS);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!state) return null;

  return (
    <Card className="mb-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <MousePointerClick className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        {state.status === "ok" ? (
          <p className="text-sm text-white">
            <span className="text-[var(--muted-foreground)]">Attribution, last 7 days</span> Visits {state.totals.visits} · Buys{" "}
            {state.totals.buys} · Revenue {formatRevenue(state.totals.revenue)}
          </p>
        ) : state.status === "unavailable" ? (
          <p className="text-sm text-[var(--muted-foreground)]">Attribution: {state.message}</p>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            Attribution is off. Set COLATERAL_ATTRIBUTION_URL and COLATERAL_ATTRIBUTION_TOKEN in .env to see visits, buys and revenue per post.
          </p>
        )}
      </div>
      {state.status === "ok" && state.lines.length > 0 ? (
        <table className="mt-3 w-full text-left text-xs">
          <thead className="text-[var(--muted-foreground)]">
            <tr>
              <th className="py-1 pr-3 font-medium">Post</th>
              <th className="px-3 py-1 text-right font-medium">Visits</th>
              <th className="px-3 py-1 text-right font-medium">Buys</th>
              <th className="py-1 pl-3 text-right font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {state.lines.slice(0, TOP_LINES).map((line) => (
              <tr key={`${line.platform}-${line.code ?? "none"}`} className="border-t border-[var(--border)] text-white">
                <td className="max-w-0 truncate py-1.5 pr-3">
                  <span className="text-[var(--muted-foreground)]">{PLATFORM_NAMES[line.platform]}</span> {lineName(line)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{line.visits}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{line.buys}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums">{formatRevenue(line.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {state.status === "ok" && state.lines.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">No visits from coded links yet.</p>
      ) : null}
    </Card>
  );
}
