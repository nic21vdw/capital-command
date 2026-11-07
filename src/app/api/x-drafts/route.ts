import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { localCalendarParts } from "@/lib/publisher/time";
import { threadsBlockedReason, threadsConfig } from "@/lib/threads/config";
import { xDraftsConfig } from "@/lib/x-drafts/config";
import { nextDateToWrite, refreshPhonePage, setDraftStatus, writeDraftsFor, writingNow } from "@/lib/x-drafts/service";
import { slotTimes } from "@/lib/x-drafts/schedule";
import { xDraftsStore } from "@/lib/x-drafts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const threads = threadsConfig();
  const config = xDraftsConfig();
  const state = await xDraftsStore.read();
  const now = new Date();
  const today = localCalendarParts(now, threads.timezone).dateKey;
  return NextResponse.json({
    today,
    timezone: threads.timezone,
    settings: {
      enabled: config.enabled,
      perDay: config.perDay,
      slots: slotTimes(config),
      threads: config.threads,
      threadsOffsetMinutes: config.threadsOffsetMinutes,
      writeAheadHour: config.writeAheadHour
    },
    threadsBlockedReason: threadsBlockedReason(threads),
    writing: writingNow(),
    nextDate: await nextDateToWrite(now, threads.timezone),
    lastWrite: state.lastWrite ?? null,
    phonePage: state.phonePage ?? null,
    drafts: state.drafts.filter((draft) => draft.batchDate >= today).sort((a, b) => a.batchDate.localeCompare(b.batchDate) || a.slot - b.slot),
    earlier: state.drafts.filter((draft) => draft.batchDate < today).sort((a, b) => b.batchDate.localeCompare(a.batchDate) || a.slot - b.slot)
  });
}

const actionSchema = z.object({
  action: z.enum(["write", "posted-x", "dismiss", "restore", "phone-page"]),
  id: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

export async function POST(request: NextRequest) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const { action, id, date } = parsed.data;
  try {
    if (action === "write") {
      const target = date ?? (await nextDateToWrite());
      if (!target) return NextResponse.json({ error: "Drafts are already written for every day this week." }, { status: 409 });
      if (writingNow()) return NextResponse.json({ error: `Already writing the drafts for ${writingNow()}.` }, { status: 409 });
      const outcome = await writeDraftsFor(target);
      if (outcome.error && outcome.created === 0) return NextResponse.json({ error: outcome.error, outcome }, { status: 502 });
      return NextResponse.json({ ok: true, outcome });
    }
    if (action === "phone-page") {
      return NextResponse.json({ ok: true, phonePage: await refreshPhonePage() });
    }
    if (!id) return NextResponse.json({ error: `"${action}" needs the id of a draft.` }, { status: 400 });
    const status = action === "posted-x" ? "posted-x" : action === "dismiss" ? "dismissed" : "new";
    const result = await setDraftStatus(id, status);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
