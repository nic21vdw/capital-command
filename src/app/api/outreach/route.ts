import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { todayLocal } from "@/lib/execution/dates";
import {
  OUTREACH_STATUSES,
  applyStatus,
  mergeContacts,
  outreachContactInputSchema,
  outreachContactSchema
} from "@/lib/outreach/model";
import { readOutreachStore, updateOutreachStore } from "@/lib/outreach/store";
import { allowsRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/outreach — the creator/affiliate tracker in data/outreach.json.
 * A tracker only: nothing here sends a message to anyone.
 */

function failure(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

function refuseForeignOrigin(request: NextRequest) {
  return allowsRequestOrigin(request)
    ? null
    : NextResponse.json({ error: "Outreach can only be changed from this app." }, { status: 403 });
}

export async function GET() {
  try {
    return NextResponse.json(await readOutreachStore());
  } catch (error) {
    return failure(error);
  }
}

/** POST { contact } — add a contact. A url already on the list updates that contact instead of duplicating it. */
export async function POST(request: NextRequest) {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { contact?: unknown } | null;
  const parsed = outreachContactInputSchema.safeParse(body?.contact);
  if (!parsed.success) {
    return NextResponse.json({ error: "A contact needs at least a name and a url." }, { status: 400 });
  }
  try {
    let added = 0;
    const store = await updateOutreachStore((current) => {
      const result = mergeContacts(current.contacts, [parsed.data]);
      added = result.added;
      return { ...current, contacts: result.contacts };
    });
    return NextResponse.json({ ...store, added: added === 1, updated: added === 0 });
  } catch (error) {
    return failure(error);
  }
}

/** Optional fields an edit may clear by sending null or "". */
const CLEARABLE = ["lastContactedAt", "nextFollowUpAt", "affiliateCode", "recentVideo"] as const;

/** Pull the cleared keys out of a patch before validation, so null/"" never has to pass a date regex. */
function splitClears(body: unknown): { body: unknown; cleared: string[] } {
  const patch = (body as { patch?: unknown } | null)?.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { body, cleared: [] };
  const rest: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
  const cleared: string[] = [];
  for (const key of CLEARABLE) {
    if (key in rest && (rest[key] === null || rest[key] === "")) {
      cleared.push(key);
      delete rest[key];
    }
  }
  return { body: { ...(body as object), patch: rest }, cleared };
}

const patchSchema = z.union([
  z.object({ id: z.string().min(1), status: z.enum(OUTREACH_STATUSES) }),
  z.object({ id: z.string().min(1), patch: outreachContactInputSchema.partial() }),
  z.object({ template: z.string().min(1) })
]);

/**
 * PATCH { id, status }    — move a contact (stamps dates, see applyStatus)
 * PATCH { id, patch }     — edit any of a contact's fields (null or "" clears a date, the code or the video)
 * PATCH { template }      — replace the outreach template
 */
export async function PATCH(request: NextRequest) {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;
  const { body: raw, cleared } = splitClears(await request.json().catch(() => null));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { id, status }, { id, patch } or { template }." }, { status: 400 });
  }
  const body = parsed.data;
  try {
    let found = true;
    const store = await updateOutreachStore((current) => {
      if ("template" in body) return { ...current, template: body.template };
      found = current.contacts.some((contact) => contact.id === body.id);
      const now = new Date().toISOString();
      return {
        ...current,
        contacts: current.contacts.map((contact) => {
          if (contact.id !== body.id) return contact;
          if ("status" in body) return applyStatus(contact, body.status, todayLocal(), now);
          const supplied = Object.fromEntries(Object.entries(body.patch).filter(([key, value]) => key !== "id" && value !== undefined));
          const merged: Record<string, unknown> = { ...contact, ...supplied, id: contact.id, updatedAt: now };
          for (const key of cleared) delete merged[key];
          return outreachContactSchema.parse(merged);
        })
      };
    });
    if (!found) return NextResponse.json({ error: "No contact with that id." }, { status: 404 });
    return NextResponse.json(store);
  } catch (error) {
    return failure(error);
  }
}

/** DELETE ?id=contact-… */
export async function DELETE(request: NextRequest) {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing contact id." }, { status: 400 });
  try {
    const store = await updateOutreachStore((current) => ({
      ...current,
      contacts: current.contacts.filter((contact) => contact.id !== id)
    }));
    return NextResponse.json(store);
  } catch (error) {
    return failure(error);
  }
}
