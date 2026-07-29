import { describe, expect, it } from "vitest";
import { LAUNCH_PLAYBOOK, buildLaunchPlan } from "@/lib/launch/playbook";
import type { ProductLaunch } from "@/lib/launch/types";

function launch(overrides: Partial<ProductLaunch> = {}): ProductLaunch {
  return {
    id: "launch-1",
    product: "CoLateral",
    productUrl: "https://colateral.ai",
    launchDate: "2026-09-15",
    status: "planning",
    completedTasks: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

describe("launch playbook", () => {
  it("gives every template a unique id", () => {
    const ids = LAUNCH_PLAYBOOK.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dates each task backwards from launch day", () => {
    const plan = buildLaunchPlan(launch(), "2026-07-01");
    const byId = new Map(plan.groups.flatMap((group) => group.tasks).map((task) => [task.id, task]));

    expect(byId.get("ph-account-warm")?.dueDate).toBe("2026-09-01");
    expect(byId.get("ph-go-live")?.dueDate).toBe("2026-09-15");
    expect(byId.get("ph-repurpose")?.dueDate).toBe("2026-09-22");
  });

  it("counts the days left and surfaces the first outstanding task", () => {
    const plan = buildLaunchPlan(launch({ completedTasks: ["ph-account-warm"] }), "2026-09-02");

    expect(plan.daysUntilLaunch).toBe(13);
    expect(plan.completed).toBe(1);
    expect(plan.total).toBe(LAUNCH_PLAYBOOK.length);
    expect(plan.nextTask?.id).toBe("ph-landing-ready");
  });

  it("flags only unfinished tasks whose due date has passed", () => {
    const plan = buildLaunchPlan(launch({ completedTasks: ["ph-account-warm"] }), "2026-09-05");
    const tasks = plan.groups.flatMap((group) => group.tasks);

    expect(tasks.find((task) => task.id === "ph-account-warm")?.overdue).toBe(false);
    expect(tasks.find((task) => task.id === "ph-landing-ready")?.overdue).toBe(true);
    expect(tasks.find((task) => task.id === "ph-go-live")?.overdue).toBe(false);
    expect(plan.overdueCount).toBe(tasks.filter((task) => task.overdue).length);
  });

  it("treats a task due today as not yet overdue", () => {
    const plan = buildLaunchPlan(launch(), "2026-09-01");
    const tasks = plan.groups.flatMap((group) => group.tasks);
    expect(tasks.find((task) => task.id === "ph-account-warm")?.overdue).toBe(false);
  });

  it("groups the tasks into the four phases in order", () => {
    const plan = buildLaunchPlan(launch(), "2026-07-01");
    expect(plan.groups.map((group) => group.phase)).toEqual(["prep", "final", "launch-day", "after"]);
    for (const group of plan.groups) {
      const dates = group.tasks.map((task) => task.dueDate);
      expect([...dates].sort()).toEqual(dates);
    }
  });

  it("reports a fully worked plan as finished with nothing next", () => {
    const plan = buildLaunchPlan(launch({ completedTasks: LAUNCH_PLAYBOOK.map((task) => task.id) }), "2026-09-30");
    expect(plan.completed).toBe(plan.total);
    expect(plan.nextTask).toBeNull();
    expect(plan.overdueCount).toBe(0);
  });
});
