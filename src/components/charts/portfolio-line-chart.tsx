"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PortfolioSnapshot } from "@/types/domain";

export function PortfolioLineChart({ data }: { data: PortfolioSnapshot[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="date" stroke="#728197" tickLine={false} axisLine={false} />
          <YAxis stroke="#728197" tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: "#07111f", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)" }} />
          <Line type="monotone" dataKey="totalValue" stroke="#d5ff7f" strokeWidth={3} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
