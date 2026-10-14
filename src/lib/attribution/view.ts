import { postCode } from "@/lib/attribution/code";
import type { AttributionRow } from "@/lib/attribution/readback";

export type PostLabel = { id: string; label: string };

export type AttributionLine = AttributionRow & { label: string | null };

export type AttributionTotals = Pick<AttributionRow, "visits" | "buys" | "orders" | "revenue">;

const LABEL_CHARS = 60;

export function postLabels(
  publishPosts: Array<{ id: string; title: string }>,
  threadsPosts: Array<{ id: string; text: string }>
): PostLabel[] {
  return [
    ...publishPosts.map((post) => ({ id: post.id, label: post.title.trim() || post.id })),
    ...threadsPosts.map((post) => {
      const text = post.text.trim().replace(/\s+/g, " ");
      return { id: post.id, label: text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS)}…` : text || post.id };
    })
  ];
}

export function joinAttribution(rows: AttributionRow[], posts: PostLabel[]): AttributionLine[] {
  const byCode = new Map(posts.map((post) => [postCode(post.id), post.label]));
  return rows
    .map((row) => ({ ...row, label: row.code ? (byCode.get(row.code) ?? null) : null }))
    .sort((a, b) => b.visits - a.visits || b.buys - a.buys);
}

export function totalsOf(rows: AttributionRow[]): AttributionTotals {
  const totals: AttributionTotals = { visits: 0, buys: 0, orders: 0, revenue: {} };
  for (const row of rows) {
    totals.visits += row.visits;
    totals.buys += row.buys;
    totals.orders += row.orders;
    for (const [currency, cents] of Object.entries(row.revenue)) {
      totals.revenue[currency] = (totals.revenue[currency] ?? 0) + cents;
    }
  }
  return totals;
}

export function formatRevenue(revenue: Record<string, number>): string {
  const parts = Object.entries(revenue)
    .filter(([, cents]) => cents > 0)
    .map(([currency, cents]) => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100));
  return parts.length ? parts.join(" · ") : "—";
}
