"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Card } from "@/components/ui/card";
import type { WeeklyAggregate } from "@/types/progress";

export function WeeklyChart({ data }: { data: WeeklyAggregate[] }) {
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">This week</p>
          <p className="mt-2 text-lg font-semibold text-white">Hours by day</p>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">Momentum compounds.</p>
      </div>
      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="label" stroke="#728197" tickLine={false} axisLine={false} />
            <YAxis stroke="#728197" tickLine={false} axisLine={false} width={32} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{
                background: "#07111f",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.1)"
              }}
              formatter={(v: number) => [`${v.toFixed(2)} h`, "Hours"]}
            />
            <Bar dataKey="hours" radius={[8, 8, 4, 4]} fill="#d5ff7f" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
