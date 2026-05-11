import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  detail,
  icon
}: {
  label: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
          {detail ? <p className="mt-2 text-sm text-[var(--muted-foreground)]">{detail}</p> : null}
        </div>
        {icon ? <div className="rounded-2xl bg-white/6 p-3 text-[var(--accent)]">{icon}</div> : null}
      </div>
    </Card>
  );
}
