"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function AssetClassBarChart({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data}>
          <XAxis dataKey="name" stroke="#728197" tickLine={false} axisLine={false} />
          <YAxis stroke="#728197" tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: "#07111f", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)" }} />
          <Bar dataKey="value" fill="#7de2d1" radius={[10, 10, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
