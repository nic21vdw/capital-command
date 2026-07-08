"use client";

import dynamic from "next/dynamic";

// The deck pulls in @remotion/player and @remotion/google-fonts, both of which
// are browser-only. Load it client-side to keep Remotion out of SSR entirely.
const PresentationDeck = dynamic(() => import("./deck").then((m) => m.PresentationDeck), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: "100vh",
        // rgb() of theme background/foreground — theme.ts is browser-only (font
        // loader), so we can't import it into this SSR-rendered fallback.
        background: "rgb(40, 42, 54)",
        color: "rgb(248, 248, 242)",
        display: "grid",
        placeItems: "center"
      }}
    >
      Loading segment deck…
    </div>
  )
});

export default function PresentationPage() {
  return <PresentationDeck />;
}
