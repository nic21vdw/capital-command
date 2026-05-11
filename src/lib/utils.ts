import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: Array<string | false | null | undefined>) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency: "CAD" | "USD" = "CAD") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);
}

export function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function initials(text: string) {
  return text
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
