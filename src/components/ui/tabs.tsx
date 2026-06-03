"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  content: React.ReactNode;
};

export function Tabs({ tabs, paramKey = "tab" }: { tabs: TabItem[]; paramKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fromUrl = searchParams.get(paramKey);
  const initial = tabs.some((tab) => tab.id === fromUrl) ? (fromUrl as string) : tabs[0]?.id;
  const [active, setActive] = useState(initial);

  const select = useCallback(
    (id: string) => {
      setActive(id);
      const params = new URLSearchParams(searchParams.toString());
      params.set(paramKey, id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [paramKey, pathname, router, searchParams]
  );

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className="space-y-6">
      <div className="flex gap-2 overflow-x-auto rounded-3xl border border-white/8 bg-[var(--panel)] p-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = current?.id === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => select(tab.id)}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2 text-sm transition",
                isActive ? "bg-white text-black" : "text-[var(--muted-foreground)] hover:bg-white/6 hover:text-white"
              )}
            >
              {Icon ? <Icon className="h-4 w-4" /> : null}
              {tab.label}
            </button>
          );
        })}
      </div>
      <div>{current?.content}</div>
    </div>
  );
}
