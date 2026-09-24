import { NextResponse } from "next/server";
import { listProjects } from "@/lib/story/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}
