import { NextResponse } from "next/server";
import { getSoundStatus } from "@/lib/sfx/sounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists the sound-effect slots and whether each carries an uploaded MP3. */
export async function GET() {
  return NextResponse.json({ sounds: await getSoundStatus() });
}
