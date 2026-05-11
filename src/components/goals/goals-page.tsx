"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { GoalProgressChart } from "@/components/charts/goal-progress-chart";
import { makeGoal, useAppData } from "@/components/providers/app-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { getMonthlyContributionRequired } from "@/lib/calculations/portfolio";
import { formatCurrency } from "@/lib/utils";
import type { Goal } from "@/types/domain";

export function GoalsPage() {
  const { data, mutate } = useAppData();
  const [editing, setEditing] = useState<Goal | null>(null);
  const [showModal, setShowModal] = useState(false);

  const saveGoal = async (formData: FormData) => {
    const goal = makeGoal(editing ?? undefined);
    goal.goalName = String(formData.get("goalName") ?? "");
    goal.targetAmount = Number(formData.get("targetAmount") ?? 0);
    goal.currentAmount = Number(formData.get("currentAmount") ?? 0);
    goal.targetDate = String(formData.get("targetDate") ?? "") || undefined;
    goal.notes = String(formData.get("notes") ?? "");
    goal.monthlyContribution = getMonthlyContributionRequired(goal);
    await mutate("upsertGoal", goal, { successMessage: editing ? "Goal updated." : "Goal added." });
    setShowModal(false);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Goals"
        title="Long-term targets with real context"
        description="Track what you are building toward and how much progress you have already locked in."
        actions={
          <Button onClick={() => { setEditing(makeGoal()); setShowModal(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Add goal
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <h2 className="text-xl font-semibold text-white">Goal progress</h2>
          <GoalProgressChart
            data={data.goals.map((goal) => ({
              name: goal.goalName,
              progress: Math.min((goal.currentAmount / Math.max(goal.targetAmount, 1)) * 100, 100)
            }))}
          />
        </Card>
        <div className="space-y-4">
          {data.goals.map((goal) => {
            const progress = Math.min((goal.currentAmount / Math.max(goal.targetAmount, 1)) * 100, 100);
            const monthly = goal.monthlyContribution ?? getMonthlyContributionRequired(goal);
            return (
              <Card key={goal.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-white">{goal.goalName}</h2>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {formatCurrency(goal.currentAmount, data.settings.currency)} of {formatCurrency(goal.targetAmount, data.settings.currency)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => { setEditing(goal); setShowModal(true); }}>Edit</Button>
                    <Button variant="danger" onClick={() => void mutate("deleteGoal", goal.id, { successMessage: "Goal deleted." })}>Delete</Button>
                  </div>
                </div>
                <Progress value={progress} className="mt-4" />
                <div className="mt-4 grid gap-2 text-sm text-[var(--muted-foreground)] md:grid-cols-3">
                  <p>Progress: <span className="text-white">{progress.toFixed(1)}%</span></p>
                  <p>Target date: <span className="text-white">{goal.targetDate ?? "Flexible"}</span></p>
                  <p>Monthly needed: <span className="text-white">{formatCurrency(monthly, data.settings.currency)}</span></p>
                </div>
                {goal.notes ? <p className="mt-3 text-sm text-[var(--muted-foreground)]">{goal.notes}</p> : null}
              </Card>
            );
          })}
        </div>
      </div>
      <Modal open={showModal} title={editing?.id ? "Edit goal" : "Add goal"} onClose={() => { setShowModal(false); setEditing(null); }}>
        <form action={saveGoal} className="grid gap-3 md:grid-cols-2">
          <Input name="goalName" placeholder="Goal name" defaultValue={editing?.goalName} required />
          <Input name="targetDate" type="date" defaultValue={editing?.targetDate} />
          <Input name="targetAmount" type="number" step="any" placeholder="Target amount" defaultValue={editing?.targetAmount} required />
          <Input name="currentAmount" type="number" step="any" placeholder="Current amount" defaultValue={editing?.currentAmount} required />
          <div className="md:col-span-2"><Textarea name="notes" placeholder="Notes" defaultValue={editing?.notes} /></div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => { setShowModal(false); setEditing(null); }}>Cancel</Button>
            <Button type="submit">Save goal</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
