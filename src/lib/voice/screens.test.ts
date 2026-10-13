import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCREENS, findScreen, visibleScreens } from "@/lib/voice/screens";

const SHELL = readFileSync(path.resolve(__dirname, "../../components/layout/app-shell.tsx"), "utf8");
const sidebar = [...SHELL.matchAll(/\{\s*href:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"/g)].map((match) => ({ href: match[1], label: match[2] }));

describe("command bar screens against the sidebar", () => {
  it("finds the sidebar to compare against", () => {
    expect(sidebar.length).toBeGreaterThan(15);
  });

  it("can open every sidebar screen, called by the sidebar's own name", () => {
    const all = visibleScreens({ personalDashboard: true });
    for (const entry of sidebar) {
      const screen = all.find((candidate) => candidate.href === entry.href);
      expect(screen, `${entry.href} (${entry.label}) has no command bar screen`).toBeDefined();
      expect(screen!.label.startsWith(entry.label), `${entry.href}: "${screen!.label}" vs sidebar "${entry.label}"`).toBe(true);
    }
  });

  it("opens the four screens it used to miss, by name", () => {
    expect(findScreen("open automations")?.href).toBe("/automations");
    expect(findScreen("automations")?.href).toBe("/automations");
    expect(findScreen("podcast")?.href).toBe("/podcast");
    expect(findScreen("execution")?.href).toBe("/execution");
  });

  it("opens finance only when the sidebar shows it", () => {
    expect(findScreen("finance")).toBeNull();
    expect(findScreen("finance", { personalDashboard: false })).toBeNull();
    expect(findScreen("finance", { personalDashboard: true })?.href).toBe("/finance");
    expect(SCREENS.find((screen) => screen.id === "finance")?.needs).toBe("personalDashboard");
    expect(visibleScreens().some((screen) => screen.href === "/finance")).toBe(false);
  });

  it("uses the renamed page titles and no longer calls the home screen Dashboard", () => {
    expect(findScreen("threads autopilot")?.href).toBe("/x-posts");
    expect(findScreen("fb / ig post library")?.href).toBe("/facebook");
    expect(SCREENS.some((screen) => screen.label === "Dashboard")).toBe(false);
    expect(findScreen("dashboard")?.href).toBe("/");
    expect(findScreen("stream pipeline")?.id).toBe("pipeline");
  });
});
