import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readAutomationHistory } from "@/lib/automations/history";
import { AUTOMATION_EVENT_KINDS, AUTOMATION_IDS } from "@/lib/automations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  automationId: z.enum(AUTOMATION_IDS).optional(),
  kind: z.enum([...AUTOMATION_EVENT_KINDS, "activity"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional()
}).strict();

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid automation, outcome and page." }, { status: 400 });
  try {
    return NextResponse.json(await readAutomationHistory(parsed.data));
  } catch {
    return NextResponse.json({ error: "Automation history could not be read. Delivery counts are unavailable." }, { status: 503 });
  }
}
