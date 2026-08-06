import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS = join(process.cwd(), "scripts");

/**
 * Windows PowerShell 5.1 reads a .ps1 with no byte-order mark as ANSI, so a
 * single em dash in a comment arrives as two bytes it cannot parse — and the
 * whole script fails to load. That is not a hypothetical: it happened, and the
 * only symptom is a release that does nothing whatsoever.
 */
describe("PowerShell scripts", () => {
  const files = readdirSync(SCRIPTS).filter((name) => name.endsWith(".ps1"));

  it("there are scripts to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s is plain ASCII", (name) => {
    const lines = readFileSync(join(SCRIPTS, name), "utf8").split(/\r?\n/);
    const offenders = lines
      .map((line, index) => ({ line, number: index + 1 }))
      // eslint-disable-next-line no-control-regex
      .filter(({ line }) => /[^\x00-\x7F]/.test(line))
      .map(({ line, number }) => `${name}:${number}: ${line.trim()}`);

    expect(offenders).toEqual([]);
  });
});
