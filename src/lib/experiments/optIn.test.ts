import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = sources(SRC);
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
const read = (file: string) => readFileSync(file, "utf8");

describe("nothing creates an experiment but a person pressing Start test", () => {
  it("calls createExperiment only from the experiments route", () => {
    const callers = files.filter((file) => /createExperiment\(/.test(read(file))).map(rel);
    expect(callers.sort()).toEqual(["app/api/experiments/route.ts", "lib/experiments/create.ts"]);
  });

  it("posts to /api/experiments from one place, the panel on a clip's card", () => {
    const posters = files.filter((file) => /fetch\(\s*"\/api\/experiments",\s*\{\s*method:\s*"POST"/.test(read(file))).map(rel);
    expect(posters).toEqual(["components/uploading-center/experiment-panel.tsx"]);
  });

  it("starts from the panel's Start test click and from no effect or timer", () => {
    const panel = read(path.join(SRC, "components", "uploading-center", "experiment-panel.tsx"));
    expect(panel).not.toMatch(/useEffect|setInterval|setTimeout/);
    expect(panel.match(/start\(\)/g)).toHaveLength(1);
    expect(panel).toMatch(/onClick=\{\(\) => void start\(\)\}/);
  });

  it("is not reachable from the pipeline, the ingest scan, the Threads autopilot, the heartbeat, the publish runner or enqueue itself", () => {
    const automatic = files.filter((file) => /^(lib\/(pipeline|ingest|threads|automations|publisher\/(runner|enqueue|queue|mirror))|instrumentation)/.test(rel(file)));
    expect(automatic.length).toBeGreaterThan(20);
    const offenders = automatic.filter((file) => /lib\/experiments|api\/experiments/.test(read(file))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("reading the list creates no experiment: the GET route never imports the creator", () => {
    const route = read(path.join(SRC, "app", "api", "experiments", "route.ts"));
    const getBody = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
    expect(getBody).not.toContain("createExperiment");
    const service = read(path.join(SRC, "lib", "experiments", "service.ts"));
    expect(service).not.toContain("createExperiment");
    expect(service).not.toContain("file.experiments.push");
  });
});
