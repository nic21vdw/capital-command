import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MAX_SHORT_TITLE } from "@/lib/clipping/titleSignals";
import { bookShortsPicks, defaultDeps, ReviewBusyError, shortsReviewState, skipShorts } from "@/lib/pipeline/shortsReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ids = z.array(z.string().regex(/^clip:[^:]+:.+$/)).min(1).max(200);
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("book"),
    ids,
    confirm: z.literal(true),
    titles: z.record(z.string(), z.string().trim().min(1).max(MAX_SHORT_TITLE)).optional()
  }),
  z.object({ action: z.literal("skip"), ids })
]);

export async function GET() {
  try {
    return NextResponse.json(await shortsReviewState());
  } catch (error) {
    return NextResponse.json({ error: `The review could not be read: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send the clips to book with confirm: true, or the clips to skip." }, { status: 400 });
  }
  try {
    if (parsed.data.action === "book") {
      const titles = parsed.data.titles;
      return NextResponse.json(titles ? await bookShortsPicks(parsed.data.ids, defaultDeps, titles) : await bookShortsPicks(parsed.data.ids));
    }
    return NextResponse.json(await skipShorts(parsed.data.ids));
  } catch (error) {
    if (error instanceof ReviewBusyError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
