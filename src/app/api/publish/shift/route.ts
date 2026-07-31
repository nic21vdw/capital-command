import { NextResponse } from "next/server";
import { z } from "zod";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { shiftDay } from "@/lib/publisher/revise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const shiftSchema = z.object({
  /** The local calendar day to move, YYYY-MM-DD in the publish timezone. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give a day as YYYY-MM-DD."),
  /** Minutes to move by; negative moves the day earlier. */
  minutes: z.number().int().refine((value) => value !== 0, "Give a non-zero number of minutes.")
});

/**
 * POST /api/publish/shift — move a whole day's still-movable posts by N
 * minutes, the queue's version of the autopilot's shiftBatch. For the morning
 * you decide everything should run an hour later without touching six posts by
 * hand.
 *
 * Posts that have already left the app are reported as `blocked` rather than
 * silently passed over: "moved 4, left 2 alone" is the honest answer, and the
 * two that stayed are the ones worth knowing about.
 *
 * A static segment beats the sibling [id] route in the App Router, so this
 * never collides with /api/publish/<some-id>.
 */
export async function POST(request: Request) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Publishing is disabled. Set PUBLISH_ENABLED=true in .env." }, { status: 400 });
  }

  let body: z.infer<typeof shiftSchema>;
  try {
    body = shiftSchema.parse(await request.json());
  } catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0]?.message : null;
    return NextResponse.json({ error: issue ?? "Invalid request body." }, { status: 400 });
  }

  const queue = publishQueue(config);
  const { moved, blocked } = shiftDay(await queue.list(), body.date, body.minutes, config.timezone);

  if (moved.length === 0) {
    return NextResponse.json(
      {
        moved: 0,
        blocked,
        error: blocked.length > 0 ? "Nothing on that day can move any more." : "Nothing scheduled on that day."
      },
      { status: 409 }
    );
  }

  // One at a time, because the store writes per item; a partial failure leaves
  // the posts it already moved moved, which is the same as any other write here.
  for (const item of moved) await queue.add(item);
  return NextResponse.json({ moved: moved.length, blocked });
}
