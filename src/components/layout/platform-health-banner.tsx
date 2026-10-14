"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { usePlatformHealth } from "@/components/layout/use-platform-health";
import { useColateralBridge } from "@/components/providers/colateral-bridge-provider";
import { bannerModel } from "@/lib/platform-health/banner";
import { cn } from "@/lib/utils";

const HEIGHT_VAR = "--platform-banner-height";

export function PlatformHealthBanner() {
  const { hosted, chrome } = useColateralBridge();
  const health = usePlatformHealth();
  const bannerRef = useRef<HTMLDivElement>(null);

  const model = bannerModel(health);

  useEffect(() => {
    const element = bannerRef.current;
    const root = document.documentElement;
    if (!model.visible || !element) {
      root.style.removeProperty(HEIGHT_VAR);
      return;
    }
    const publish = () => root.style.setProperty(HEIGHT_VAR, `${Math.ceil(element.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, [model.visible]);

  if (!model.visible) return null;

  const compact = hosted && chrome !== "full";

  return (
    <div
      ref={bannerRef}
      role="alert"
      data-platform-health-banner=""
      className="sticky top-0 z-40 border-b border-[color-mix(in_srgb,var(--danger)_55%,transparent)] bg-[color-mix(in_srgb,var(--danger)_16%,var(--panel))] text-white"
    >
      <div className={cn("flex flex-col gap-1.5 px-3 py-2 sm:px-4", compact && "gap-1 px-2 py-1.5")}>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <TriangleAlert className="h-4 w-4 shrink-0 text-[var(--danger)]" />
          <span className="min-w-0">{model.headline}</span>
        </p>
        <ul className="space-y-1">
          {model.entries.map((entry) => (
            <li key={entry.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {model.entries.length > 1 && <span className="font-medium">{entry.displayName}</span>}
              <span className="text-[var(--muted-foreground-2)]">
                broke {entry.sinceLabel}
                {entry.agoLabel ? ` (${entry.agoLabel})` : ""}
              </span>
              <span className="min-w-0 flex-1 basis-40 truncate text-[var(--muted-foreground)]" title={entry.reason}>
                {entry.reason}
              </span>
              <Link
                href={entry.fixUrl}
                className="shrink-0 rounded-md bg-[var(--danger)] px-2.5 py-1 font-semibold text-[#fff] transition hover:opacity-90"
              >
                {entry.fixLabel}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
