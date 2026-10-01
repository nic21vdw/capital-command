import { describe, expect, it } from "vitest";
import { parseAutomationTasks } from "@/lib/automations/tasks";

describe("Windows automation task evidence", () => {
  it("keeps missing and other-checkout tasks distinct from observed running tasks", () => {
    const tasks = parseAutomationTasks(JSON.stringify([
      { id: "publisher", state: "running", nextRunAt: "2026-10-01T15:05:00Z", lastRunAt: "2026-10-01T15:00:00Z", lastResult: 267009, schedule: "PT5M" },
      { id: "threads", state: "other-checkout", nextRunAt: null, lastRunAt: null, lastResult: null, schedule: null },
      { id: "ingest", state: "missing", nextRunAt: null, lastRunAt: null, lastResult: null, schedule: null }
    ]));
    expect(tasks.publisher?.state).toBe("running");
    expect(tasks.threads?.nextRunAt).toBeNull();
    expect(tasks.ingest?.state).toBe("missing");
  });

  it("rejects malformed task evidence", () => {
    expect(() => parseAutomationTasks('{"id":"publisher","state":"healthy"}')).toThrow();
  });
});
