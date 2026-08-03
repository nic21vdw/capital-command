import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runAgentTeam } from "@/lib/agents/orchestrator";
import { providerStatus } from "@/lib/agents/provider";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { listAgentRuns } from "@/lib/agents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  goal: z.string().trim().min(1).max(20_000),
  provider: z.enum(["chatgpt", "grok"]),
  agentIds: z.array(z.enum(["strategist", "researcher", "producer", "operator"])).min(1).max(4)
});

export async function GET() {
  return NextResponse.json({ agents: AGENT_REGISTRY, providers: providerStatus(), runs: await listAgentRuns() });
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid agent request." }, { status: 400 });
  const run = await runAgentTeam(parsed.data);
  return NextResponse.json({ run }, { status: run.status === "failed" ? 502 : 201 });
}
