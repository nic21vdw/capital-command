import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRoute } from "./protocol";
import { CAPITAL_COMMAND_ROUTES, CAPITAL_COMMAND_SECONDARY_ROUTES, allRoutes, isKnownRoute, routeLabel } from "./routes";

/**
 * The sidebar is the app's own menu and this list is the card's. They have to
 * agree, or a page added to one is unreachable from the other — which is
 * exactly how the card's route list came to be eleven entries against the
 * app's thirty-two. Reading the shell as text rather than importing it keeps
 * this a plain unit test: app-shell.tsx is a client component full of JSX and
 * lucide icons, and the suite has no React environment.
 */
const SHELL = readFileSync(
  path.resolve(__dirname, "../../components/layout/app-shell.tsx"),
  "utf8"
);

function sidebarEntries(): { href: string; label: string }[] {
  const entries: { href: string; label: string }[] = [];
  const pattern = /\{\s*href:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(SHELL))) {
    entries.push({ href: match[1], label: match[2] });
  }
  return entries;
}

describe("the card's route list against the app's sidebar", () => {
  it("finds the sidebar to compare against", () => {
    // A rename that moves the nav elsewhere would otherwise make every
    // assertion below pass against nothing.
    expect(sidebarEntries().length).toBeGreaterThan(15);
  });

  it("lists every page the sidebar can reach", () => {
    const missing = sidebarEntries()
      .filter((entry) => !isKnownRoute(normalizeRoute(entry.href)))
      .map((entry) => `${entry.href} (${entry.label})`);
    expect(missing).toEqual([]);
  });

  it("calls each page what the sidebar calls it", () => {
    const renamed = sidebarEntries()
      .filter((entry) => isKnownRoute(entry.href) && routeLabel(entry.href) !== entry.label)
      // "/" is "Stream Pipeline" in both; only a genuine drift shows up here.
      .map((entry) => `${entry.href}: sidebar "${entry.label}" vs card "${routeLabel(entry.href)}"`);
    expect(renamed).toEqual([]);
  });

  it("has a page on disk for every route it lists", () => {
    const missing = allRoutes()
      .filter((route) => route.path !== "/")
      .filter((route) => {
        const dir = route.path.replace(/^\//, "");
        try {
          readFileSync(path.resolve(__dirname, "../../app", dir, "page.tsx"), "utf8");
          return false;
        } catch {
          return true;
        }
      })
      .map((route) => route.path);
    expect(missing).toEqual([]);
  });

  it("never lists the same path twice", () => {
    const paths = allRoutes().map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("normalizes every path it ships", () => {
    for (const route of allRoutes()) {
      expect(normalizeRoute(route.path)).toBe(route.path);
    }
  });

  it("keeps the pipeline order the sidebar reads in", () => {
    const groups = CAPITAL_COMMAND_ROUTES.map((route) => route.group);
    const firstSeen = [...new Set(groups)];
    expect(firstSeen).toEqual(["Import", "Formats", "Schedule", "Calendar", "Studio", "System"]);
    // Each group is contiguous: the rail draws one heading per group.
    expect(groups.join(" ")).toBe(firstSeen.map((group) => groups.filter((g) => g === group).join(" ")).join(" "));
  });

  it("keeps secondary routes out of the main list", () => {
    const main = new Set(CAPITAL_COMMAND_ROUTES.map((route) => route.path));
    for (const route of CAPITAL_COMMAND_SECONDARY_ROUTES) {
      expect(main.has(route.path)).toBe(false);
    }
  });
});
