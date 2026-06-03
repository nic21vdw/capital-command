"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@/types/domain";

export function SparklineChart({
  data,
  height = 140,
  showAxis = false
}: {
  data: TrendPoint[];
  height?: number;
  showAxis?: boolean;
}) {
  const gradientId = useId().replace(/:/g, "");

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            hide={!showAxis}
            stroke="#728197"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            fontSize={11}
          />
          <YAxis hide stroke="#728197" tickLine={false} axisLine={false} domain={["dataMin", "dataMax"]} />
          <Tooltip
            contentStyle={{ background: "#07111f", borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)" }}
            labelStyle={{ color: "#8d9aae" }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
