"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function GoalProgressChart({ data }: { data: Array<{ name: string; progress: number }> }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart layout="vertical" data={data}>
          <XAxis type="number" stroke="#728197" tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" stroke="#728197" tickLine={false} axisLine={false} width={120} />
          <Tooltip contentStyle={{ background: "#07111f", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)" }} />
          <Bar dataKey="progress" fill="#ffb86a" radius={[0, 10, 10, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
