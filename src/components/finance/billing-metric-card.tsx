"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { SparklineChart } from "@/components/charts/sparkline-chart";
import { Card } from "@/components/ui/card";
import type { BillingMetric } from "@/types/domain";
import { cn } from "@/lib/utils";

export function BillingMetricCard({
  label,
  value,
  metric,
  invertChange = false
}: {
  label: string;
  value: string;
  metric: BillingMetric;
  /** When true, a positive change is treated as unfavorable (e.g. churn). */
  invertChange?: boolean;
}) {
  const positive = invertChange ? metric.changePercent < 0 : metric.changePercent >= 0;
  const Icon = metric.changePercent >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            positive ? "bg-emerald-400/12 text-emerald-300" : "bg-red-400/12 text-red-300"
          )}
        >
          <Icon className="h-3 w-3" />
          {Math.abs(metric.changePercent).toFixed(2)}%
        </span>
      </div>
      <p className="text-3xl font-semibold text-white">{value}</p>
      <SparklineChart data={metric.trend} height={96} />
    </Card>
  );
}
