"use client";

import type { PaymentBreakdownItem } from "@/types/domain";
import { formatCurrency } from "@/lib/utils";

export function PaymentsBreakdownBar({
  items,
  currency
}: {
  items: PaymentBreakdownItem[];
  currency: "CAD" | "USD";
}) {
  const total = items.reduce((sum, item) => sum + item.amount, 0) || 1;

  return (
    <div className="space-y-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/6">
        {items.map((item) => {
          const width = (item.amount / total) * 100;
          if (width <= 0) return null;
          return (
            <div
              key={item.label}
              style={{ width: `${width}%`, backgroundColor: item.color }}
              title={`${item.label}: ${formatCurrency(item.amount, currency)}`}
            />
          );
        })}
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-white">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
            <span className="text-[var(--muted-foreground)]">{formatCurrency(item.amount, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
