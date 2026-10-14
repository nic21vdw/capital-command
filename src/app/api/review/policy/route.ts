import { NextResponse } from "next/server";
import { z } from "zod";
import { REVIEW_MODES } from "@/lib/publisher/approval";
import { readReviewPolicy, writeReviewPolicy } from "@/lib/publisher/approvalStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mode = z.enum(REVIEW_MODES);

const changeSchema = z
  .object({
    youtube: mode.optional(),
    instagram: mode.optional(),
    tiktok: mode.optional(),
    facebook: mode.optional(),
    threads: mode.optional()
  })
  .strict()
  .refine((change) => Object.keys(change).length > 0, "Name at least one channel.");

export async function GET() {
  return NextResponse.json({ policy: readReviewPolicy() });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body naming channels and auto or hold." }, { status: 400 });
  }
  const parsed = changeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  return NextResponse.json({ policy: await writeReviewPolicy(parsed.data) });
}
