"use client";

import type { ReactNode } from "react";
import { useNavSection } from "@/components/layout/nav-section";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  const section = useNavSection() ?? eyebrow;
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {section ? <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">{section}</p> : null}
        <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted-foreground)]">{description}</p>
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">{actions}</div> : null}
    </div>
  );
}
