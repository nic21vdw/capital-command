"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { nextVisitedTabs } from "@/components/ui/tab-keepalive";

export type TabItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  content: React.ReactNode;
};

export function Tabs(props: { tabs: TabItem[]; paramKey?: string }) {
  return (
    <Suspense fallback={<div className="min-h-[100px]" />}>
      <TabsInner {...props} />
    </Suspense>
  );
}

function TabsInner({ tabs, paramKey = "tab" }: { tabs: TabItem[]; paramKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabIdKey = tabs.map((tab) => tab.id).join("|");
  const tabIds = useMemo(() => (tabIdKey ? tabIdKey.split("|") : []), [tabIdKey]);

  const fromUrl = searchParams.get(paramKey);
  const resolved = tabs.some((tab) => tab.id === fromUrl) ? (fromUrl as string) : tabs[0]?.id;

  const [active, setActive] = useState(resolved);
  // Mount a tab the first time it (or its neighbor) is selected, then keep it
  // mounted so scroll position, draft fields, and local UI state survive a
  // click back — the old `key={current.id}` remount wiped all of that.
  const [visited, setVisited] = useState(() => nextVisitedTabs(new Set(), resolved ?? "", tabIds));

  // Browser back/forward and deep links update the URL; mirror that into state.
  useEffect(() => {
    if (!resolved || resolved === active) return;
    setActive(resolved);
    setVisited((current) => nextVisitedTabs(current, resolved, tabIds));
  }, [resolved, active, tabIds]);

  const select = useCallback(
    (id: string) => {
      setActive(id);
      setVisited((current) => nextVisitedTabs(current, id, tabIds));
      const params = new URLSearchParams(searchParams.toString());
      params.set(paramKey, id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [paramKey, pathname, router, searchParams, tabIds]
  );

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = current?.id === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => select(tab.id)}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm transition-all duration-200 ease-out",
                isActive
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:bg-white/6 hover:text-white"
              )}
            >
              {Icon ? <Icon className="h-4 w-4" /> : null}
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => {
        if (!visited.has(tab.id)) return null;
        const isActive = current?.id === tab.id;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            hidden={!isActive}
            // Keep inactive panels in the tree (scroll + drafts survive) but
            // out of layout; only the newly shown panel gets the enter motion.
            className={cn(isActive && "panel-enter")}
          >
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}
