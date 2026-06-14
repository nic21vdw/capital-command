"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { makeExecutionGoal, useAppData } from "@/components/providers/app-provider";
import { EXECUTION_ICON_KEYS, resolveExecutionIcon } from "@/components/execution/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EXECUTION_CATEGORIES } from "@/lib/execution/view-model";
import type { ExecutionGoal } from "@/types/domain";

export function GoalManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, mutate } = useAppData();
  const [editing, setEditing] = useState<ExecutionGoal | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExecutionGoal | null>(null);

  const goals = [...data.executionGoals].sort((a, b) => a.displayOrder - b.displayOrder);
  const activeGoals = goals.filter((goal) => goal.active && !goal.archivedAt);
  const archivedGoals = goals.filter((goal) => !goal.active || goal.archivedAt);

  const reorder = async (goal: ExecutionGoal, direction: -1 | 1) => {
    const ordered = [...activeGoals];
    const index = ordered.findIndex((entry) => entry.id === goal.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await mutate("reorderExecutionGoals", ordered.map((entry) => entry.id));
  };

  return (
    <Modal open={open} title="Manage goals" description="Add, edit, reorder, archive, or remove recurring goals." onClose={onClose}>
      <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
        <div className="flex justify-end">
          <Button onClick={() => setEditing(makeExecutionGoal({ displayOrder: activeGoals.length }))}>
            <Plus className="mr-2 h-4 w-4" />
            New goal
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted-foreground)]">Active</p>
          {activeGoals.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No active goals yet.</p>
          ) : (
            activeGoals.map((goal, index) => {
              const Icon = resolveExecutionIcon(goal.icon);
              return (
                <Card key={goal.id} className="flex items-center justify-between gap-3 rounded-2xl p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="rounded-xl bg-white/6 p-2 text-[var(--accent)]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{goal.title}</p>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">
                        {goal.category} · {goal.frequency === "daily" ? `${goal.dailyTarget}/day` : `${goal.weeklyTarget}/week`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" className="px-2" aria-label="Move up" disabled={index === 0} onClick={() => void reorder(goal, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2"
                      aria-label="Move down"
                      disabled={index === activeGoals.length - 1}
                      onClick={() => void reorder(goal, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(goal)}>
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void mutate("archiveExecutionGoal", goal.id, { successMessage: "Goal archived." })}
                    >
                      Archive
                    </Button>
                  </div>
                </Card>
              );
            })
          )}
        </div>

        {archivedGoals.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted-foreground)]">Archived</p>
            {archivedGoals.map((goal) => {
              const Icon = resolveExecutionIcon(goal.icon);
              return (
                <Card key={goal.id} className="flex items-center justify-between gap-3 rounded-2xl p-3 opacity-80">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="rounded-xl bg-white/6 p-2 text-[var(--muted-foreground)]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{goal.title}</p>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{goal.category} · archived</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="secondary"
                      onClick={() => void mutate("reactivateExecutionGoal", goal.id, { successMessage: "Goal reactivated." })}
                    >
                      Reactivate
                    </Button>
                    <Button variant="danger" onClick={() => setConfirmDelete(goal)}>
                      Delete
                    </Button>
                  </div>
                </Card>
              );
            })}
            <p className="text-xs text-[var(--muted-foreground)]">
              Archived goals keep their history in past weekly reports. Deleting a goal permanently removes its records.
            </p>
          </div>
        ) : null}
      </div>

      {editing ? <GoalEditor goal={editing} onDone={() => setEditing(null)} /> : null}

      <Modal
        open={Boolean(confirmDelete)}
        title="Delete goal?"
        description="This permanently removes the goal and all of its completions, debt, and history. Archiving is usually the better choice."
        onClose={() => setConfirmDelete(null)}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirmDelete) void mutate("deleteExecutionGoal", confirmDelete.id, { successMessage: "Goal deleted." });
              setConfirmDelete(null);
            }}
          >
            Delete permanently
          </Button>
        </div>
      </Modal>
    </Modal>
  );
}

function GoalEditor({ goal, onDone }: { goal: ExecutionGoal; onDone: () => void }) {
  const { mutate } = useAppData();
  const [frequency, setFrequency] = useState<ExecutionGoal["frequency"]>(goal.frequency);
  const [saving, setSaving] = useState(false);

  const save = async (formData: FormData) => {
    if (saving) return;
    setSaving(true);
    const dailyTarget = Number(formData.get("dailyTarget") ?? 0);
    const weeklyTarget = Number(formData.get("weeklyTarget") ?? 0);
    const next = makeExecutionGoal({
      ...goal,
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
      category: String(formData.get("category") ?? "CoLateral") as ExecutionGoal["category"],
      frequency,
      dailyTarget: frequency === "daily" ? Math.max(1, dailyTarget) : 0,
      weeklyTarget: frequency === "daily" ? Math.max(1, dailyTarget) * 7 : Math.max(1, weeklyTarget),
      icon: String(formData.get("icon") ?? "Target")
    });
    await mutate("upsertExecutionGoal", next, { successMessage: "Goal saved." });
    setSaving(false);
    onDone();
  };

  return (
    <Modal open title={goal.title ? "Edit goal" : "New goal"} onClose={onDone}>
      <form action={save} className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Input name="title" placeholder="Goal title" defaultValue={goal.title} required />
        </div>
        <Select name="category" defaultValue={goal.category}>
          {EXECUTION_CATEGORIES.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </Select>
        <Select name="icon" defaultValue={goal.icon}>
          {EXECUTION_ICON_KEYS.map((key) => (
            <option key={key}>{key}</option>
          ))}
        </Select>
        <Select
          name="frequency"
          value={frequency}
          onChange={(event) => setFrequency(event.target.value as ExecutionGoal["frequency"])}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </Select>
        {frequency === "daily" ? (
          <Input
            name="dailyTarget"
            type="number"
            min="1"
            step="1"
            placeholder="Per-day target"
            defaultValue={goal.dailyTarget || 1}
            required
          />
        ) : (
          <Input
            name="weeklyTarget"
            type="number"
            min="1"
            step="1"
            placeholder="Per-week target"
            defaultValue={goal.weeklyTarget || 1}
            required
          />
        )}
        <div className="md:col-span-2">
          <Textarea name="description" placeholder="Optional description" defaultValue={goal.description} />
        </div>
        <div className="md:col-span-2 flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save goal"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
