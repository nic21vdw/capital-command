import { NextResponse } from "next/server";
import { removeAccount, renameAccount } from "@/lib/publisher/accounts";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/publish/accounts/:accountId — rename an added account. */
export async function PATCH(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  let body: { label?: unknown };
  try {
    body = (await request.json()) as { label?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label : "";
  const { accountId } = await params;
  try {
    const account = await renameAccount(accountId, label);
    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

/**
 * DELETE /api/publish/accounts/:accountId — remove an added account. Refused
 * while the account still has scheduled posts, so no calendar entry is ever
 * orphaned; primaries are permanent.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const config = publisherConfig();
  const { accountId } = await params;
  const items = config.enabled ? await publishQueue(config).list() : [];
  try {
    await removeAccount(accountId, items);
    return NextResponse.json({ removed: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
