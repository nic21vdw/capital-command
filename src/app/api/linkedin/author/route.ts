import { NextRequest, NextResponse } from "next/server";
import { addLinkedinOrganization, linkedinAuthors, selectLinkedinAuthor } from "@/lib/publisher/linkedinAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await linkedinAuthors(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  let body: { author?: unknown; organizationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const author = typeof body.author === "string" ? body.author : null;
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : null;
  if (!author && !organizationId) {
    return NextResponse.json({ error: "Send { author } to switch, or { organizationId } to add a page." }, { status: 400 });
  }
  try {
    if (organizationId) await addLinkedinOrganization(organizationId);
    if (author) await selectLinkedinAuthor(author);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  return NextResponse.json(await linkedinAuthors(), { headers: { "Cache-Control": "no-store" } });
}
