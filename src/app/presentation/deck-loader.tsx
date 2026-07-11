"use client";

import dynamic from "next/dynamic";

// The deck pulls in @remotion/player and @remotion/google-fonts, both of which
// are browser-only. Load it client-side to keep Remotion out of SSR entirely.
export const DeckLoader = dynamic(() => import("./deck").then((m) => m.PresentationDeck), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[60vh] place-items-center rounded-xl border border-[var(--border)] bg-[var(--panel)] text-sm text-[var(--muted-foreground)]">
      Loading segment deck…
    </div>
  )
});
