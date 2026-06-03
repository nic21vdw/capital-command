"use client";

import { useState } from "react";
import { Cpu, MonitorSmartphone, Pencil, Plus, Server, Sparkles, Trash2, Wallet } from "lucide-react";
import { AllocationDonutChart } from "@/components/charts/allocation-donut-chart";
import { AssetClassBarChart } from "@/components/charts/asset-class-bar-chart";
import { makeExpense, useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Textarea } from "@/components/ui/textarea";
import { deriveExpenseSummary } from "@/lib/calculations/expenses";
import { formatCurrency } from "@/lib/utils";
import type { Expense, ExpenseCategory, ExpenseFrequency } from "@/types/domain";

const categories: ExpenseCategory[] = [
  "Hardware",
  "AI Subscription",
  "Cloud",
  "Software",
  "Peripherals",
  "Other"
];

const frequencies: ExpenseFrequency[] = ["one-time", "monthly", "yearly"];

const frequencyLabel: Record<ExpenseFrequency, string> = {
  "one-time": "One-time",
  monthly: "Monthly",
  yearly: "Yearly"
};

export function ExpenseSection() {
  const { data, mutate } = useAppData();
  const currency = data.settings.currency;
  const summary = deriveExpenseSummary(data.expenses, currency);

  const [editing, setEditing] = useState<Expense | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<"All" | ExpenseCategory>("All");

  const visible = data.expenses
    .filter((expense) => categoryFilter === "All" || expense.category === categoryFilter)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const openAdd = () => {
    setEditing(makeExpense());
    setShowModal(true);
  };

  const openEdit = (expense: Expense) => {
    setEditing(expense);
    setShowModal(true);
  };

  const saveExpense = async (formData: FormData) => {
    const item = makeExpense(editing ?? undefined);
    item.name = String(formData.get("name") ?? "");
    item.vendor = String(formData.get("vendor") ?? "");
    item.category = String(formData.get("category") ?? "Other") as ExpenseCategory;
    item.frequency = String(formData.get("frequency") ?? "monthly") as ExpenseFrequency;
    item.amount = Number(formData.get("amount") ?? 0);
    item.currency = String(formData.get("currency") ?? "USD") as Expense["currency"];
    item.date = String(formData.get("date") ?? item.date);
    item.active = formData.get("active") === "on";
    item.notes = String(formData.get("notes") ?? "");
    item.updatedAt = new Date().toISOString();
    await mutate("upsertExpense", item, { successMessage: editing && data.expenses.some((e) => e.id === editing.id) ? "Expense updated." : "Expense added." });
    setShowModal(false);
    setEditing(null);
  };

  const donutData = summary.byCategory.map((entry) => ({ name: entry.category, value: Math.round(entry.total) }));
  const monthlyData = summary.monthlyByCategory.map((entry) => ({ name: entry.category, value: entry.value }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-xl font-semibold text-white">AI &amp; setup spending</h2>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add expense
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total invested in setup"
          value={formatCurrency(summary.totalInvested, currency)}
          detail={`${formatCurrency(summary.oneTimeTotal, currency)} one-time + recurring`}
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          label="Monthly recurring"
          value={formatCurrency(summary.monthlyRecurring, currency)}
          detail={`${formatCurrency(summary.annualRecurring, currency)} / year`}
          icon={<Server className="h-5 w-5" />}
        />
        <StatCard
          label="AI subscriptions"
          value={`${formatCurrency(summary.aiMonthly, currency)}/mo`}
          detail={`${summary.activeSubscriptions} active subscriptions`}
          icon={<Sparkles className="h-5 w-5" />}
        />
        <StatCard
          label="Hardware & PC build"
          value={formatCurrency(summary.hardwareTotal, currency)}
          detail="One-time hardware investment"
          icon={<Cpu className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-white">Spend by category</h3>
            <p className="text-sm text-[var(--muted-foreground)]">
              Recurring costs annualized to monthly, plus one-time purchases.
            </p>
          </div>
          {donutData.length ? (
            <AllocationDonutChart data={donutData} />
          ) : (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">No expenses tracked yet.</p>
          )}
        </Card>
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <h3 className="text-lg font-semibold text-white">Monthly recurring by category</h3>
              <p className="text-sm text-[var(--muted-foreground)]">Normalized monthly run rate.</p>
            </div>
          </div>
          {monthlyData.length ? (
            <AssetClassBarChart data={monthlyData} />
          ) : (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">No recurring subscriptions yet.</p>
          )}
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">All expenses</h3>
          <Select
            className="w-auto"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}
          >
            <option value="All">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </div>
        {visible.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-[var(--muted-foreground)]">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Frequency</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((expense) => (
                  <tr key={expense.id} className="border-t border-white/6">
                    <td className="px-3 py-3">
                      <p className="font-medium text-white">{expense.name}</p>
                      {expense.vendor ? (
                        <p className="text-xs text-[var(--muted-foreground)]">{expense.vendor}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Badge>{expense.category}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-[var(--muted-foreground)]">{frequencyLabel[expense.frequency]}</span>
                      {expense.frequency !== "one-time" && !expense.active ? (
                        <span className="ml-2 text-xs text-amber-300">paused</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right text-white">
                      {formatCurrency(expense.amount, expense.currency)}
                      <span className="text-xs text-[var(--muted-foreground)]"> {expense.currency}</span>
                    </td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)]">{expense.date}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" className="px-2" onClick={() => openEdit(expense)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 text-red-300"
                          onClick={() =>
                            void mutate("deleteExpense", expense.id, { successMessage: "Expense removed." })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            No expenses in this view. Add your PC build, GPU, or AI subscriptions to get started.
          </p>
        )}
      </Card>

      <Modal
        open={showModal}
        title={editing && data.expenses.some((e) => e.id === editing.id) ? "Edit expense" : "Add expense"}
        description="Track one-time hardware or recurring AI and cloud subscriptions."
        onClose={() => {
          setShowModal(false);
          setEditing(null);
        }}
      >
        <form
          action={saveExpense}
          className="grid gap-4 md:grid-cols-2"
          key={editing?.id ?? "new"}
        >
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm text-[var(--muted-foreground)]">Name</label>
            <Input name="name" defaultValue={editing?.name} placeholder="e.g. Claude Max" required />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[var(--muted-foreground)]">Vendor</label>
            <Input name="vendor" defaultValue={editing?.vendor} placeholder="e.g. Anthropic" />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[var(--muted-foreground)]">Category</label>
            <Select name="category" defaultValue={editing?.category ?? "AI Subscription"}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-[var(--muted-foreground)]">Frequency</label>
            <Select name="frequency" defaultValue={editing?.frequency ?? "monthly"}>
              {frequencies.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {frequencyLabel[frequency]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-[var(--muted-foreground)]">Amount</label>
            <Input name="amount" type="number" step="0.01" min="0" defaultValue={editing?.amount} required />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[var(--muted-foreground)]">Currency</label>
            <Select name="currency" defaultValue={editing?.currency ?? "USD"}>
              <option value="USD">USD</option>
              <option value="CAD">CAD</option>
            </Select>
          </div>
          <div>
            <label className="mb-2 block text-sm text-[var(--muted-foreground)]">Date / start</label>
            <Input name="date" type="date" defaultValue={editing?.date} />
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <input
              id="expense-active"
              name="active"
              type="checkbox"
              defaultChecked={editing?.active ?? true}
              className="h-4 w-4 rounded border-white/20 bg-black/20"
            />
            <label htmlFor="expense-active" className="text-sm text-[var(--muted-foreground)]">
              Active (counts toward recurring totals)
            </label>
          </div>
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm text-[var(--muted-foreground)]">Notes</label>
            <Textarea name="notes" defaultValue={editing?.notes} placeholder="Optional context" />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowModal(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit">Save expense</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
