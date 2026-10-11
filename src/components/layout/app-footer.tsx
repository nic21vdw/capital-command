"use client";

import { useEffect, useState } from "react";

/**
 * Quiet for the first moments of a page. The footer is the last thing in the
 * column, so while a screen is still filling in it sits near the top and is
 * then thrown off the bottom - the biggest single layout shift on the short
 * pages. It is not drawn (not merely hidden: a hidden box still counted) until
 * the page has had time to settle.
 */
const SETTLE_MS = 1500;

export function AppFooter() {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!settled) return null;
  return (
    <footer className="mt-10 border-t border-[var(--border)] pt-6 text-sm text-[var(--muted-foreground)]">
      CoLateral Marketing runs on this computer. Keep it open for scheduled posts to go out.
    </footer>
  );
}
