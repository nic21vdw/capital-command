"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EnrichedHolding } from "@/lib/calculations/portfolio";

export function HoldingPerformanceChart({ data }: { data: EnrichedHolding[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data}>
          <XAxis dataKey="ticker" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
          <YAxis stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", color: "var(--foreground)" }} />
          <Bar dataKey="gainLossPercent" fill="#6ea8fe" radius={[10, 10, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
