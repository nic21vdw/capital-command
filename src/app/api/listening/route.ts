import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RESULT_STATUSES, keywordGroupSchema } from "@/lib/listening/model";
import { applyScan, collectScan } from "@/lib/listening/scan";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";
import { allowsRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full scan spaces its Reddit queries out, so it can take most of a minute.
export const maxDuration = 120;

/**
 * /api/listening — keyword groups, source switches and results in
 * data/listening.json, and the "Scan now" action. Nothing here posts a reply;
 * replying stays a human act, done on the site itself.
 */

function failure(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

function refuseForeignOrigin(request: NextRequest) {
  return allowsRequestOrigin(request)
    ? null
    : NextResponse.json({ error: "Listening can only be changed from this app." }, { status: 403 });
}

export async function GET() {
  try {
    return NextResponse.json(await readListeningStore());
  } catch (error) {
    return failure(error);
  }
}

/** POST { action: "scan" } — query every enabled source now and fold the results in. */
export async function POST(request: NextRequest) {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "scan") return NextResponse.json({ error: 'Send { action: "scan" }.' }, { status: 400 });
  try {
    const collected = await collectScan(await readListeningStore());
    let report = null as ReturnType<typeof applyScan>["report"] | null;
    const store = await updateListeningStore((current) => {
      const applied = applyScan(current, collected);
      report = applied.report;
      return applied.store;
    });
    return NextResponse.json({ ...store, report });
  } catch (error) {
    return failure(error);
  }
}

const patchSchema = z.union([
  z.object({
    resultId: z.string().min(1),
    status: z.enum(RESULT_STATUSES).optional(),
    note: z.string().optional()
  }),
  z.object({ groups: z.array(keywordGroupSchema) }),
  z.object({ sources: z.object({ hn: z.boolean(), reddit: z.boolean() }) })
]);

/**
 * PATCH { resultId, status?, note? } — triage one result
 * PATCH { groups }                   — replace the keyword groups
 * PATCH { sources: { hn, reddit } }  — switch sources on or off
 */
export async function PATCH(request: NextRequest) {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { resultId, status?, note? }, { groups } or { sources }." }, { status: 400 });
  }
  const body = parsed.data;
  try {
    let found = true;
    const store = await updateListeningStore((current) => {
      if ("groups" in body) return { ...current, groups: body.groups };
      if ("sources" in body) return { ...current, sources: body.sources };
      found = current.results.some((result) => result.id === body.resultId);
      return {
        ...current,
        results: current.results.map((result) =>
          result.id === body.resultId
            ? { ...result, status: body.status ?? result.status, note: body.note ?? result.note }
            : result
        )
      };
    });
    if (!found) return NextResponse.json({ error: "No result with that id." }, { status: 404 });
    return NextResponse.json(store);
  } catch (error) {
    return failure(error);
  }
}
