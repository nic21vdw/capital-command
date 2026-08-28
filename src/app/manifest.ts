import type { MetadataRoute } from "next";

/**
 * What makes Chrome offer "Install Capital Command" — the app then gets its own
 * window, its own taskbar and Start Menu entry, and no address bar. The
 * launcher (Capital Command.bat) opens the same thing without installing, so
 * either route lands on a windowed app rather than a browser tab.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Capital Command",
    short_name: "Capital Command",
    description: "The CoLateral command centre for the channel: pipeline, clips, calendar and the publish queue.",
    start_url: "/",
    display: "standalone",
    background_color: "#070c12",
    theme_color: "#4da6ff",
    icons: [
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
