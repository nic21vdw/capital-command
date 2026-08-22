"use client";

import { useSearchParams } from "next/navigation";
import { DaySummaryPage } from "@/components/master-calendar/day-summary-page";

/** `/day-summary?date=YYYY-MM-DD` — how the calendar hands a day over. */
export function DaySummaryRoute() {
  return <DaySummaryPage initialDate={useSearchParams().get("date") ?? undefined} />;
}
