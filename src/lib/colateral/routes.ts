/*
 * Every page of Capital Command, as the canvas card lists them.
 * ---------------------------------------------------------------------------
 * The Capital Command Card in CoLateral draws a route rail down its left edge,
 * and it needs the same names and the same grouping the sidebar uses or the
 * card becomes a second, worse menu. This is that list, in the sidebar's own
 * order: the four pipeline stages, then the studio tools that feed them.
 *
 * `colateral:list-routes` hands it to the host at runtime, so the card is right
 * about an app newer than itself instead of shipping a copy that rots. The copy
 * CoLateral keeps is only the fallback for a card that has not shaken hands yet.
 *
 * `routes.test.ts` reads app-shell.tsx and fails if the sidebar grows a page
 * this list does not have.
 */

import type { RouteEntry } from "./protocol";

export const ROUTE_GROUPS = ["Import", "Formats", "Schedule", "Calendar", "Studio", "System"] as const;

export const CAPITAL_COMMAND_ROUTES: RouteEntry[] = [
  { path: "/", label: "Stream Pipeline", group: "Import" },

  { path: "/longform", label: "Long-Form Video", group: "Formats" },
  { path: "/clips", label: "Short Clips", group: "Formats" },
  { path: "/editor", label: "Clip Editor", group: "Formats" },
  { path: "/carousels", label: "Carousels & Images", group: "Formats" },
  { path: "/podcast", label: "Podcast / Spotify", group: "Formats" },
  { path: "/x-posts", label: "X / Threads Posts", group: "Formats" },
  { path: "/facebook", label: "FB / IG Threads", group: "Formats" },
  { path: "/launch", label: "Launch Pad", group: "Formats" },

  { path: "/uploading-center", label: "Uploading Center", group: "Schedule" },
  { path: "/distribution", label: "Distribution Centre", group: "Schedule" },

  { path: "/master-calendar", label: "Master Calendar", group: "Calendar" },
  { path: "/day-summary", label: "Day Summary", group: "Calendar" },

  { path: "/agents", label: "Sourceflow Agents", group: "Studio" },
  { path: "/ideas", label: "Idea Lab", group: "Studio" },
  { path: "/scripts", label: "Scripts", group: "Studio" },
  { path: "/outliers", label: "Outlier Radar", group: "Studio" },
  { path: "/execution", label: "Execution", group: "Studio" },
  { path: "/presentation", label: "Segment Deck", group: "Studio" },
  { path: "/voiceover", label: "Voiceover", group: "Studio" },
  { path: "/music", label: "Music Studio", group: "Studio" },
  { path: "/finance", label: "Personal Finance", group: "Studio" },

  { path: "/settings", label: "Settings", group: "System" }
];

/**
 * Pages that exist and are reachable, but are not sidebar destinations: they
 * are opened from inside another screen. The card lists them so an agent can
 * still send someone there, under a heading that says they are secondary.
 */
export const CAPITAL_COMMAND_SECONDARY_ROUTES: RouteEntry[] = [
  { path: "/pipeline", label: "Stream Pipeline (alias)", group: "System" },
  { path: "/creator", label: "Creator", group: "System" },
  { path: "/goals", label: "Goals", group: "System" },
  { path: "/holdings", label: "Holdings", group: "System" },
  { path: "/insights", label: "Insights", group: "System" },
  { path: "/notes", label: "Notes", group: "System" },
  { path: "/thumbnails", label: "Thumbnails", group: "System" },
  { path: "/watchlist", label: "Watchlist", group: "System" },
  { path: "/youtube", label: "YouTube", group: "System" }
];

const BY_PATH = new Map<string, RouteEntry>(
  [...CAPITAL_COMMAND_ROUTES, ...CAPITAL_COMMAND_SECONDARY_ROUTES].map((route) => [route.path, route])
);

export function routeLabel(path: string): string {
  return BY_PATH.get(path)?.label ?? path;
}

export function isKnownRoute(path: string): boolean {
  return BY_PATH.has(path);
}

export function allRoutes(): RouteEntry[] {
  return [...CAPITAL_COMMAND_ROUTES, ...CAPITAL_COMMAND_SECONDARY_ROUTES];
}
