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

/**
 * Splatting a SCALAR spreads it one character per argument, so a variable that
 * is sometimes a list and sometimes a single value turns `github/main` into
 * eight arguments and git answers `unknown revision 'g'`. `Select-Object
 * -Unique` is the usual way in: it hands back a bare string the moment the list
 * has one entry left, which for a release is the default case — main into main.
 * Every splatted variable must therefore be assigned through `@(...)`.
 */
/** True when `@(` opens the expression and its own `)` closes it. */
function enclosedInArrayOperator(expression: string): boolean {
  if (!expression.startsWith("@(")) return false;
  let depth = 0;
  for (let index = 1; index < expression.length; index += 1) {
    if (expression[index] === "(") depth += 1;
    if (expression[index] === ")") {
      depth -= 1;
      if (depth === 0) return index === expression.length - 1;
    }
  }
  return false;
}

describe("splatted variables are always arrays", () => {
  const files = readdirSync(SCRIPTS).filter((name) => name.endsWith(".ps1"));

  it.each(files)("%s", (name) => {
    const source = readFileSync(join(SCRIPTS, name), "utf8");
    const splatted = new Set(
      [...source.matchAll(/(?<![\w$])@([A-Za-z_]\w*)\b/g)].map((match) => match[1])
    );

    const offenders: string[] = [];
    for (const variable of splatted) {
      const assignments = [
        ...source.matchAll(new RegExp(`^\\s*\\$${variable}\\s*=\\s*(.+)$`, "gm"))
      ];
      // A splat of something this script never assigns is a parameter or a
      // hashtable literal built elsewhere; there is nothing here to check.
      if (assignments.length === 0) continue;
      for (const [, rhs] of assignments) {
        const expression = rhs.trim();
        if (expression.startsWith("@{")) continue;
        // `@(...) | Select-Object -Unique` also starts with `@(`, and is
        // exactly the bug: the array is built and then piped back to a scalar.
        // What matters is that the LAST thing applied is the array operator.
        if (enclosedInArrayOperator(expression)) continue;
        offenders.push(`${name}: $${variable} = ${expression}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
