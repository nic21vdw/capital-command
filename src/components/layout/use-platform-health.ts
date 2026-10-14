"use client";

import { useEffect, useState } from "react";
import type { PlatformHealthResponse } from "@/lib/platform-health/types";

const POLL_MS = 60_000;

export function usePlatformHealth(): PlatformHealthResponse | null {
  const [health, setHealth] = useState<PlatformHealthResponse | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      fetch("/api/health/platforms", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: PlatformHealthResponse | null) => {
          if (live && body) setHealth(body);
        })
        .catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return health;
}
