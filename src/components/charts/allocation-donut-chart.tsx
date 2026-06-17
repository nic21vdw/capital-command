"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { chartColors } from "@/components/charts/chart-theme";

export function AllocationDonutChart({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={64} outerRadius={100} paddingAngle={3}>
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", color: "var(--foreground)" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
