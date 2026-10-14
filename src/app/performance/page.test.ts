import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAPITAL_COMMAND_ROUTES } from "@/lib/colateral/routes";

const APP = path.resolve(__dirname, "..");
const read = (...segments: string[]) => readFileSync(path.join(APP, ...segments), "utf8");

describe("the Performance page", () => {
  it("is where /insights now goes, not the finance tab", () => {
    const source = read("insights", "page.tsx");

    expect(source).toMatch(/redirect\("\/performance"\)/);
    expect(source).not.toContain("finance");
  });

  it("is titled like its sidebar entry", () => {
    expect(read("performance", "page.tsx")).toMatch(/title:\s*"Performance \| CoLateral Marketing"/);
  });

  it("is in the sidebar and in the card's route list under Calendar", () => {
    const shell = readFileSync(path.resolve(APP, "../components/layout/app-shell.tsx"), "utf8");

    expect(shell).toMatch(/\{\s*href:\s*"\/performance",\s*label:\s*"Performance"/);
    expect(CAPITAL_COMMAND_ROUTES).toContainEqual({ path: "/performance", label: "Performance", group: "Calendar" });
  });

  it("declares what it shows to the canvas", () => {
    const source = readFileSync(path.resolve(APP, "../components/performance/performance-page.tsx"), "utf8");

    expect(source).toContain("useColateralSurface");
    expect(source).toContain('route: "/performance"');
  });
});
