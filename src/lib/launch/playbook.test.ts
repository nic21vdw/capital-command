import { describe, expect, it } from "vitest";
import { ALL_LAUNCH_TASK_IDS, DIRECTORY_PLAYBOOK, LAUNCH_PLAYBOOK, buildLaunchPlan } from "@/lib/launch/playbook";
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
  it("gives every template a unique id, across both lists", () => {
    const ids = ALL_LAUNCH_TASK_IDS;
    expect(ids).toHaveLength(LAUNCH_PLAYBOOK.length + DIRECTORY_PLAYBOOK.length);
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
    expect(plan.total).toBe(LAUNCH_PLAYBOOK.length + DIRECTORY_PLAYBOOK.length);
    // BetaList is due the same day as the account warm-up, and still open.
    expect(plan.nextTask?.id).toBe("dir-betalist");

    const later = buildLaunchPlan(launch({ completedTasks: ["ph-account-warm", "dir-betalist"] }), "2026-09-02");
    expect(later.nextTask?.id).toBe("ph-landing-ready");
  });

  it("flags only unfinished tasks whose due date has passed", () => {
    const plan = buildLaunchPlan(launch({ completedTasks: ["ph-account-warm"] }), "2026-09-05");
    const tasks = plan.groups.flatMap((group) => group.tasks);

    expect(tasks.find((task) => task.id === "ph-account-warm")?.overdue).toBe(false);
    expect(tasks.find((task) => task.id === "ph-landing-ready")?.overdue).toBe(true);
    expect(tasks.find((task) => task.id === "ph-go-live")?.overdue).toBe(false);
    // The overdue count covers the directory submissions too.
    expect(plan.overdueCount).toBe([...tasks, ...plan.directories].filter((task) => task.overdue).length);
    expect(plan.directories.find((task) => task.id === "dir-betalist")?.overdue).toBe(true);
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
    const plan = buildLaunchPlan(launch({ completedTasks: ALL_LAUNCH_TASK_IDS }), "2026-09-30");
    expect(plan.completed).toBe(plan.total);
    expect(plan.nextTask).toBeNull();
    expect(plan.overdueCount).toBe(0);
  });

  it("keeps the Product Hunt phases free of directory tasks", () => {
    const plan = buildLaunchPlan(launch(), "2026-07-01");
    const phased = plan.groups.flatMap((group) => group.tasks);
    expect(phased).toHaveLength(LAUNCH_PLAYBOOK.length);
    expect(phased.every((task) => task.id.startsWith("ph-"))).toBe(true);
  });
});

describe("directory submissions", () => {
  it("covers each directory once, with a dir- id, a url and a requirements note", () => {
    expect(DIRECTORY_PLAYBOOK.map((task) => task.id)).toEqual([
      "dir-betalist",
      "dir-devhunt",
      "dir-uneed",
      "dir-alternativeto",
      "dir-taaft",
      "dir-futurepedia",
      "dir-show-hn",
      "dir-peerlist"
    ]);
    for (const task of DIRECTORY_PLAYBOOK) {
      expect(task.family).toBe("directory");
      expect(task.url).toMatch(/^https:\/\//);
      expect(task.detail.length).toBeGreaterThan(40);
    }
  });

  it("dates every directory off launch day, in order", () => {
    const plan = buildLaunchPlan(launch(), "2026-07-01");
    const byId = new Map(plan.directories.map((task) => [task.id, task.dueDate]));
    expect(byId.get("dir-betalist")).toBe("2026-09-01");
    expect(byId.get("dir-show-hn")).toBe("2026-09-16");
    expect(byId.get("dir-peerlist")).toBe("2026-09-22");
    const dates = plan.directories.map((task) => task.dueDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it("reads a launch saved before directories existed: Product Hunt progress kept, directories all open", () => {
    const saved = launch({ completedTasks: LAUNCH_PLAYBOOK.map((task) => task.id) });
    const plan = buildLaunchPlan(saved, "2026-09-30");
    expect(plan.completed).toBe(LAUNCH_PLAYBOOK.length);
    expect(plan.directories.every((task) => !task.done)).toBe(true);
    expect(plan.nextTask?.id).toBe("dir-betalist");
    expect(plan.overdueCount).toBe(DIRECTORY_PLAYBOOK.length);
  });

  it("marks a directory done from the same completedTasks list", () => {
    const plan = buildLaunchPlan(launch({ completedTasks: ["dir-show-hn"] }), "2026-09-20");
    const showHn = plan.directories.find((task) => task.id === "dir-show-hn")!;
    expect(showHn.done).toBe(true);
    expect(showHn.overdue).toBe(false);
    expect(plan.directories.find((task) => task.id === "dir-betalist")?.overdue).toBe(true);
  });

  it("never pitches CoLateral as anything but the agentic workspace", () => {
    for (const task of DIRECTORY_PLAYBOOK) {
      expect(`${task.label} ${task.detail}`).not.toMatch(/engineer|structural|beam|column|code check/i);
    }
  });
});
