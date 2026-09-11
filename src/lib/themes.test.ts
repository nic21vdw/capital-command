import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { settingsSchema } from "@/lib/storage/schemas";
import {
  DEFAULT_THEME,
  LEGACY_THEME_IDS,
  isThemePreset,
  normalizeThemePreset,
  themePresetIds,
  themePresets
} from "@/lib/themes";

const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

function declarationsOf(selector: string): Set<string> {
  const start = rules.indexOf(selector);
  if (start === -1) return new Set();
  const open = rules.indexOf("{", start);
  const close = rules.indexOf("}", open);
  return new Set(
    rules
      .slice(open + 1, close)
      .split(";")
      .map((line) => line.split(":")[0]?.trim())
      .filter((name): name is string => Boolean(name))
  );
}

// Every property the :root fallback declares, which is what a half-added preset
// silently inherits from whichever theme was applied before it.
const REQUIRED = [...declarationsOf(":root {")];

describe("the theme presets", () => {
  it("declares CoLateral Dark as the default", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(themePresetIds).toContain(DEFAULT_THEME);
  });

  it("has the 17 CoLateral theme ids", () => {
    expect(themePresetIds).toEqual([
      "dark",
      "light",
      "dracula",
      "catppuccin",
      "nord",
      "tokyonight",
      "gruvbox",
      "everforest",
      "github",
      "ayu",
      "onedark",
      "monokai",
      "rosepine",
      "solarized",
      "linear",
      "absolutely",
      "codex"
    ]);
  });

  it("has unique ids", () => {
    expect(new Set(themePresetIds).size).toBe(themePresetIds.length);
  });

  it.each(themePresetIds)("%s survives a settings round trip", (id) => {
    expect(settingsSchema.parse({ currency: "CAD", themePreset: id }).themePreset).toBe(id);
  });

  it.each(themePresetIds)("%s declares every variable :root does", (id) => {
    const declared = declarationsOf(`[data-theme="${id}"] {`);
    expect(declared.size).toBeGreaterThan(0);
    expect(REQUIRED.filter((name) => !declared.has(name))).toEqual([]);
  });

  it.each(themePresets.filter((theme) => theme.mode === "light").map((theme) => theme.id))(
    "%s joins the light-theme readability remap",
    (id) => {
      const remapAt = rules.indexOf("--color-amber-100");
      const selectors = rules.slice(rules.lastIndexOf("}", remapAt), remapAt);
      expect(selectors).toContain(`[data-theme="${id}"]`);
    }
  );

  it("rejects retired preset ids", () => {
    expect(isThemePreset("slate")).toBe(false);
    expect(isThemePreset("accent-blue")).toBe(false);
  });

  it("maps legacy stored ids to their CoLateral equivalent", () => {
    expect(normalizeThemePreset("colateral")).toBe("dark");
    expect(normalizeThemePreset("colateral-light")).toBe("light");
    for (const legacyId of ["slate", "midnight", "graphite", "forest", "paper", "arctic"]) {
      expect(normalizeThemePreset(legacyId)).toBe(DEFAULT_THEME);
    }
  });

  it("falls back to the default theme for junk or missing values", () => {
    expect(normalizeThemePreset("nonsense")).toBe(DEFAULT_THEME);
    expect(normalizeThemePreset(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeThemePreset(null)).toBe(DEFAULT_THEME);
  });

  it("passes every current preset through normalizeThemePreset unchanged", () => {
    for (const id of themePresetIds) {
      expect(normalizeThemePreset(id)).toBe(id);
    }
  });

  it("keeps LEGACY_THEME_IDS pointed at real presets", () => {
    for (const target of Object.values(LEGACY_THEME_IDS)) {
      expect(themePresetIds).toContain(target);
    }
  });

  it("paints the default palette before hydration", () => {
    const root = declarationsOf(":root {");
    const preset = declarationsOf(`[data-theme="${DEFAULT_THEME}"] {`);
    expect([...preset]).toEqual([...root]);
  });
});
