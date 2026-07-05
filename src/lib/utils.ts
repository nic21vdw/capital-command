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

/**
 * Turns an arbitrary project/clip name into a safe download filename (without
 * extension). Strips characters that are illegal on common filesystems and
 * collapses whitespace so "My Clip: Part 2" becomes "My Clip - Part 2".
 */
export function safeFilename(name: string, fallback = "clip") {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "-") // characters disallowed on Windows/macOS
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "") // no leading dots (hidden files / traversal)
    .slice(0, 120)
    .trim();
  return cleaned || fallback;
}

export function initials(text: string) {
  return text
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
