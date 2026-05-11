"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EnrichedHolding } from "@/lib/calculations/portfolio";

export function HoldingPerformanceChart({ data }: { data: EnrichedHolding[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data}>
          <XAxis dataKey="ticker" stroke="#728197" tickLine={false} axisLine={false} />
          <YAxis stroke="#728197" tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: "#07111f", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)" }} />
          <Bar dataKey="gainLossPercent" fill="#6ea8fe" radius={[10, 10, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
