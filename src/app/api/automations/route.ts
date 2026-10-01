import { NextRequest, NextResponse } from "next/server";
import { allowsRequestOrigin } from "@/lib/request-origin";
import { z } from "zod";
import { automationOverview } from "@/lib/automations/overview";
import { setAutomationPaused } from "@/lib/automations/store";
import { AUTOMATION_IDS } from "@/lib/automations/types";
import { readAppData, writeAppData } from "@/lib/storage/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), id: z.enum(AUTOMATION_IDS), paused: z.boolean() }).strict(),
  z.object({ action: z.literal("overnight-scheduling"), enabled: z.boolean() }).strict()
]);

export async function GET() {
  try {
    return NextResponse.json(await automationOverview());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Automation status could not be loaded." }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an automation and a boolean pause state, or change overnight scheduling." }, { status: 400 });
  if (!allowsRequestOrigin(request)) return NextResponse.json({ error: "Automation controls must be changed from this app." }, { status: 403 });
  try {
    if (parsed.data.action === "pause") {
      return NextResponse.json({ id: parsed.data.id, control: await setAutomationPaused(parsed.data.id, parsed.data.paused) });
    }
    const data = await readAppData();
    await writeAppData({ ...data, settings: { ...data.settings, autoScheduleOvernight: parsed.data.enabled } });
    return NextResponse.json({ autoScheduleOvernight: parsed.data.enabled });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Automation controls could not be saved." }, { status: 503 });
  }
}
