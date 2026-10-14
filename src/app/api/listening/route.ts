import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateListeningConfig } from "@/lib/listening/config";
import { leadSummary } from "@/lib/listening/leads";
import { MAX_KEYWORD_GROUPS, keywordGroupSchema } from "@/lib/listening/model";
import { sendHitToOutreach } from "@/lib/listening/outreach";
import { runListeningScan } from "@/lib/listening/run";
import { readListeningSnapshot, readListeningStore, updateListeningStore } from "@/lib/listening/store";
import { allowsRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full scan spaces its Reddit queries out and then classifies what it found, so it can take minutes.
export const maxDuration = 300;

/**
 * /api/listening - keyword groups, source switches and results, and the
 * "Scan now" action. Nothing here posts a reply; replying stays a human act,
 * done on the site itself. Keywords live in data/listening/config.json and the
 * hits in data/listening.json.
 */

function failure(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

function refuseForeignOrigin(request: NextRequest) {
  return allowsRequestOrigin(request)
    ? null
    : NextResponse.json({ error: "Listening can only be changed from this app." }, { status: 403 });
}

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("summary") === "1") {
      const store = await readListeningStore();
      return NextResponse.json({ ...leadSummary(store.results), lastScanAt: store.lastScan?.at ?? null });
    }
    return NextResponse.json(await readListeningSnapshot());
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { action?: unknown; resultId?: unknown } | null;
  try {
    if (body?.action === "scan") {
      const outcome = await runListeningScan();
      return NextResponse.json({ ...(await readListeningSnapshot()), report: outcome.report, joined: outcome.joined, newLeads: outcome.newLeads });
    }
    if (body?.action === "send-to-outreach" && typeof body.resultId === "string") {
      const sent = await sendHitToOutreach(body.resultId);
      return NextResponse.json({ ...(await readListeningSnapshot()), ...sent });
    }
    return NextResponse.json({ error: 'Send { action: "scan" } or { action: "send-to-outreach", resultId }.' }, { status: 400 });
  } catch (error) {
    return failure(error, error instanceof Error && /No result with that id/.test(error.message) ? 404 : 500);
  }
}

const patchSchema = z.union([
  z.object({
    resultId: z.string().min(1),
    status: z.enum(["new", "seen", "dismissed"]).optional(),
    note: z.string().optional()
  }),
  z.object({ groups: z.array(keywordGroupSchema).max(MAX_KEYWORD_GROUPS) }),
  z.object({ sources: z.object({ hn: z.boolean(), reddit: z.boolean(), youtube: z.boolean(), bluesky: z.boolean(), x: z.boolean() }).partial() }),
  z.object({ autoScan: z.boolean() })
]);

/**
 * PATCH { resultId, status?, note? } - triage one result
 * PATCH { groups }                   - replace the keyword groups
 * PATCH { sources: { hn?, reddit?, youtube?, bluesky?, x? } } - switch sources on or off
 * PATCH { autoScan }                 - the two-hourly scan on or off
 */
export async function PATCH(request: NextRequest) {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { resultId, status?, note? }, { groups }, { sources } or { autoScan }." }, { status: 400 });
  }
  const body = parsed.data;
  try {
    if ("resultId" in body) {
      let found = true;
      await updateListeningStore((current) => {
        found = current.results.some((result) => result.id === body.resultId);
        return {
          ...current,
          results: current.results.map((result) =>
            result.id === body.resultId ? { ...result, status: body.status ?? result.status, note: body.note ?? result.note } : result
          )
        };
      });
      if (!found) return NextResponse.json({ error: "No result with that id." }, { status: 404 });
    } else if ("groups" in body) {
      await updateListeningConfig((current) => ({ ...current, groups: body.groups }));
    } else if ("sources" in body) {
      await updateListeningConfig((current) => ({ ...current, sources: { ...current.sources, ...body.sources } }));
    } else {
      await updateListeningConfig((current) => ({ ...current, autoScan: body.autoScan }));
    }
    return NextResponse.json(await readListeningSnapshot());
  } catch (error) {
    return failure(error);
  }
}
