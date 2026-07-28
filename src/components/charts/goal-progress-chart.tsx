"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function GoalProgressChart({ data }: { data: Array<{ name: string; progress: number }> }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart layout="vertical" data={data}>
          <XAxis type="number" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={120} />
          <Tooltip contentStyle={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", color: "var(--foreground)" }} />
          <Bar dataKey="progress" fill="#ffb86a" radius={[0, 10, 10, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
