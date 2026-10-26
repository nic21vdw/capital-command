import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function canvasSpecs(config: string): string[] {
  const block = /CANVAS_SPECS\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? "";
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("the specs that load the canvas addon run in a forked process", () => {
  const root = canvasSpecs(read("vitest.config.ts"));
  const qa = canvasSpecs(read("qa/vitest.config.mjs"));

  it("are listed, and exist", () => {
    expect(root.length).toBeGreaterThan(0);
    for (const spec of root) expect(existsSync(path.join(process.cwd(), spec)), spec).toBe(true);
  });

  it("are the same list in the normal config and the sandbox one", () => {
    expect(qa).toEqual(root);
  });

  it("get the forks pool in both, and are kept out of the threaded project", () => {
    for (const file of ["vitest.config.ts", "qa/vitest.config.mjs"]) {
      const config = read(file);
      expect(config, file).toMatch(/name:\s*"canvas"[\s\S]*pool:\s*"forks"/);
      expect(config, file).toMatch(/exclude:\s*\[[^\]]*\.\.\.CANVAS_SPECS/);
      expect(config, file).not.toContain("poolMatchGlobs");
    }
  });
});
