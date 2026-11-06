import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONAL_GROUP_LABEL, PERSONAL_NAV, PERSONAL_ROUTE_PATHS, isPersonalRoute } from "../personal-routes";
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

  it("does not list redirect stubs as pages", () => {
    // A route whose page is only `redirect(...)` is not a destination; listing
    // it tells an agent the app has a page it does not.
    const stubs = allRoutes()
      .filter((route) => route.path !== "/")
      .filter((route) => {
        const dir = route.path.replace(/^\//, "");
        const source = readFileSync(path.resolve(__dirname, "../../app", dir, "page.tsx"), "utf8");
        return /\bredirect\(/.test(source);
      })
      .map((route) => route.path);
    expect(stubs).toEqual([]);
    for (const retired of ["/youtube", "/creator", "/notes", "/thumbnails", "/insights", "/goals", "/holdings", "/watchlist"]) {
      expect(isKnownRoute(retired)).toBe(false);
    }
  });
});

describe("personal finance is off the marketing surface", () => {
  const componentSources = [
    "finance/finance-page.tsx",
    "finance/finances-page.tsx",
    "holdings/holdings-page.tsx",
    "watchlist/watchlist-page.tsx",
    "goals/goals-page.tsx",
    "dashboard/insights-page.tsx"
  ].map((file) => ({ file, source: readFileSync(path.resolve(__dirname, "../../components", file), "utf8") }));

  it("names every personal path", () => {
    expect([...PERSONAL_ROUTE_PATHS]).toEqual(["/finance", "/holdings", "/watchlist", "/goals"]);
    expect(PERSONAL_NAV).toEqual([{ href: "/finance", label: "Personal Finance" }]);
    expect(PERSONAL_GROUP_LABEL).toBe("Personal");
  });

  it("recognises a personal path however it is written", () => {
    expect(isPersonalRoute("/finance")).toBe(true);
    expect(isPersonalRoute("/finance/")).toBe(true);
    expect(isPersonalRoute("/holdings?tab=1")).toBe(true);
    expect(isPersonalRoute("/clips")).toBe(false);
    expect(isPersonalRoute("/")).toBe(false);
  });

  it("is in neither the card's route list nor its secondary list", () => {
    for (const personal of PERSONAL_ROUTE_PATHS) {
      expect(isKnownRoute(personal), personal).toBe(false);
      expect(allRoutes().some((route) => route.path === personal), personal).toBe(false);
    }
    expect(allRoutes().some((route) => /finance/i.test(route.label))).toBe(false);
  });

  it("calls the page Personal if the host ever asks what it is", () => {
    expect(routeLabel("/finance")).toBe("Personal");
    expect(routeLabel("/holdings")).toBe("Personal");
  });

  it("keeps every page on disk, so it is still reachable by URL", () => {
    for (const personal of PERSONAL_ROUTE_PATHS) {
      expect(() => readFileSync(path.resolve(__dirname, "../../app", personal.slice(1), "page.tsx"), "utf8"), personal).not.toThrow();
    }
  });

  it("is not a sidebar entry in the marketing groups", () => {
    expect(sidebarEntries().filter((entry) => isPersonalRoute(entry.href))).toEqual([]);
  });

  it("is a collapsed Personal group in the sidebar, built from the personal nav", () => {
    expect(SHELL).toContain("PERSONAL_NAV");
    expect(SHELL).toContain("PERSONAL_GROUP_LABEL");
    expect(SHELL).not.toMatch(/href:\s*"\/finance"/);
  });

  it("declares nothing to the canvas from any of its components, and none of them were deleted", () => {
    for (const { file, source } of componentSources) {
      expect(source.length, file).toBeGreaterThan(200);
      expect(source, file).not.toContain("useColateralSurface");
    }
  });
});
