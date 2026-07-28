"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PortfolioSnapshot } from "@/types/domain";

export function PortfolioLineChart({ data }: { data: PortfolioSnapshot[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="date" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
          <YAxis stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", color: "var(--foreground)" }} />
          <Line type="monotone" dataKey="totalValue" stroke="var(--accent)" strokeWidth={3} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
