import type { Expense, ExpenseCategory } from "@/types/domain";

// Lightweight static FX so totals can be reported in a single display currency.
// Personal-tracking estimate only — not a live rate.
const USD_TO_CAD = 1.37;

export function toCurrency(amount: number, from: "CAD" | "USD", target: "CAD" | "USD"): number {
  if (from === target) return amount;
  if (from === "USD" && target === "CAD") return amount * USD_TO_CAD;
  return amount / USD_TO_CAD;
}

/** Normalizes any expense to its equivalent monthly cost in the target currency. */
export function monthlyEquivalent(expense: Expense, target: "CAD" | "USD"): number {
  if (!expense.active) return 0;
  const amount = toCurrency(expense.amount, expense.currency, target);
  if (expense.frequency === "monthly") return amount;
  if (expense.frequency === "yearly") return amount / 12;
  return 0;
}

export interface CategoryBreakdown {
  category: ExpenseCategory;
  oneTime: number;
  monthly: number;
  total: number;
}

export interface ExpenseSummary {
  totalInvested: number;
  oneTimeTotal: number;
  monthlyRecurring: number;
  annualRecurring: number;
  aiMonthly: number;
  cloudMonthly: number;
  hardwareTotal: number;
  activeSubscriptions: number;
  byCategory: CategoryBreakdown[];
  monthlyByCategory: { category: ExpenseCategory; value: number }[];
}

const CATEGORIES: ExpenseCategory[] = [
  "Hardware",
  "AI Subscription",
  "Cloud",
  "Software",
  "Peripherals",
  "Other"
];

export function deriveExpenseSummary(expenses: Expense[], target: "CAD" | "USD"): ExpenseSummary {
  const byCategoryMap = new Map<ExpenseCategory, CategoryBreakdown>();
  for (const category of CATEGORIES) {
    byCategoryMap.set(category, { category, oneTime: 0, monthly: 0, total: 0 });
  }

  let oneTimeTotal = 0;
  let monthlyRecurring = 0;
  let aiMonthly = 0;
  let cloudMonthly = 0;
  let hardwareTotal = 0;
  let activeSubscriptions = 0;

  for (const expense of expenses) {
    const bucket = byCategoryMap.get(expense.category)!;
    const monthly = monthlyEquivalent(expense, target);

    if (expense.frequency === "one-time") {
      const amount = toCurrency(expense.amount, expense.currency, target);
      oneTimeTotal += amount;
      bucket.oneTime += amount;
      bucket.total += amount;
    } else if (expense.active) {
      monthlyRecurring += monthly;
      bucket.monthly += monthly;
      bucket.total += monthly;
      activeSubscriptions += 1;
    }

    if (monthly > 0) {
      if (expense.category === "AI Subscription") aiMonthly += monthly;
      if (expense.category === "Cloud") cloudMonthly += monthly;
    }
    if (expense.category === "Hardware" && expense.frequency === "one-time") {
      hardwareTotal += toCurrency(expense.amount, expense.currency, target);
    }
  }

  const byCategory = CATEGORIES.map((category) => byCategoryMap.get(category)!).filter(
    (entry) => entry.total > 0
  );

  const monthlyByCategory = CATEGORIES.map((category) => ({
    category,
    value: Math.round(byCategoryMap.get(category)!.monthly * 100) / 100
  })).filter((entry) => entry.value > 0);

  return {
    totalInvested: oneTimeTotal + monthlyRecurring,
    oneTimeTotal,
    monthlyRecurring,
    annualRecurring: monthlyRecurring * 12,
    aiMonthly,
    cloudMonthly,
    hardwareTotal,
    activeSubscriptions,
    byCategory,
    monthlyByCategory
  };
}
