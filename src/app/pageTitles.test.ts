import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONAL_NAV } from "@/lib/personal-routes";

/**
 * The nav label and the page title are the same words (CLAUDE.md). Seven of nine
 * screens shared one bare "CoLateral Marketing" title, so the taskbar and the
 * browser history could not tell them apart.
 */
const shell = readFileSync(join(process.cwd(), "src/components/layout/app-shell.tsx"), "utf8");
const items = [...shell.matchAll(/\{ href: "(\/[a-z-]*)", label: "([^"]+)"/g)].map((match) => ({ href: match[1], label: match[2] }));

function titleFor(href: string): string {
  const dir = join(process.cwd(), "src/app", href === "/" ? "" : href);
  const sources = ["page.tsx", "layout.tsx"].map((file) => join(dir, file)).filter(existsSync).map((file) => readFileSync(file, "utf8"));
  return sources.join("\n").match(/export const metadata[^]*?title:\s*"([^"]+)"/)?.[1] ?? "";
}

describe("page titles", () => {
  it("finds the nav items", () => {
    expect(items.length).toBeGreaterThan(20);
  });

  it.each(items)("$href is titled with its nav label", ({ href, label }) => {
    expect(titleFor(href)).toBe(`${label} | CoLateral Marketing`);
  });
});

describe("personal page titles", () => {
  it.each(PERSONAL_NAV)("$href is titled with its nav label", ({ href, label }) => {
    expect(titleFor(href)).toBe(`${label} | CoLateral Marketing`);
  });
});

function pageHeaderTitles(dir: string, found = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pageHeaderTitles(full, found);
    else if (entry.name.endsWith(".tsx")) {
      for (const match of readFileSync(full, "utf8").matchAll(/<PageHeader\b[^>]*?\btitle="([^"]+)"/g)) found.add(match[1]);
    }
  }
  return found;
}

describe("page headings", () => {
  const headings = pageHeaderTitles(join(process.cwd(), "src"));
  const screens = [...items, ...PERSONAL_NAV].filter((item) => item.href !== "/");

  it.each(screens)("$href has a PageHeader headed with its nav label", ({ label }) => {
    expect(headings).toContain(label);
  });
});
