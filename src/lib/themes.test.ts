import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { settingsSchema } from "@/lib/storage/schemas";
import { DEFAULT_THEME, isThemePreset, themePresetIds, themePresets } from "@/lib/themes";

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
    expect(DEFAULT_THEME).toBe("colateral");
    expect(themePresetIds).toContain(DEFAULT_THEME);
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

  it("still accepts a theme a user saved before the default changed", () => {
    expect(isThemePreset("slate")).toBe(true);
    expect(isThemePreset("accent-blue")).toBe(false);
  });

  it("paints the default palette before hydration", () => {
    const root = declarationsOf(":root {");
    const preset = declarationsOf(`[data-theme="${DEFAULT_THEME}"] {`);
    expect([...preset]).toEqual([...root]);
  });
});
