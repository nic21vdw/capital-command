import { z } from "zod";
import { sourceflowContext } from "@/lib/agents/context";
import { newAgentRunId, runAgentTeam } from "@/lib/agents/orchestrator";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { getAgentRun, listAgentRuns } from "@/lib/agents/store";
import { ingestOverview, startIngestScan } from "@/lib/ingest/service";
import { createRunFromUrl, getRun, listRuns, overviewContext, runOverview } from "@/lib/pipeline/runs";

export type VoiceToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  action: boolean;
};

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false } as const;

export const VOICE_TOOLS: VoiceToolDefinition[] = [
  {
    name: "sourceflow_state",
    description: "Read the current Capital Command snapshot: content by status, recent items, recent pipeline runs, studio counts.",
    parameters: NO_ARGS,
    action: false
  },
  {
    name: "list_pipeline_runs",
    description: "List the most recent Stream Pipeline runs with their status.",
    parameters: NO_ARGS,
    action: false
  },
  {
    name: "pipeline_run_status",
    description: "Report one Stream Pipeline run in detail: every stage, what is ready to schedule, and what is still working. Reading a run also advances it.",
    parameters: {
      type: "object",
      properties: { runId: { type: "string", description: "The pipeline run id." } },
      required: ["runId"],
      additionalProperties: false
    },
    action: false
  },
  {
    name: "channel_check",
    description: "Look at the YouTube channel and report which recent uploads are new to the pipeline and which are skipped and why. Takes nothing in — this is the dry run.",
    parameters: {
      type: "object",
      properties: {
        liveOnly: { type: "boolean", description: "Only consider live stream VODs. Defaults to true." },
        lookbackDays: { type: "number", description: "How many days back to look. Defaults to 7." }
      },
      additionalProperties: false
    },
    action: false
  },
  {
    name: "ingest_status",
    description: "Report the channel ingest ledger — what has already been taken in — plus any scan running right now and its log.",
    parameters: NO_ARGS,
    action: false
  },
  {
    name: "agent_run_status",
    description: "Report a Sourceflow agent team run: each specialist's state, the reconciled answer, and any actions waiting for approval.",
    parameters: {
      type: "object",
      properties: { runId: { type: "string", description: "The agent run id. Omit for the most recent run." } },
      additionalProperties: false
    },
    action: false
  },
  {
    name: "start_channel_ingest",
    description: "Scan the YouTube channel and put every new stream through the whole Stream Pipeline unattended, stopping at ready-to-schedule. Never publishes. Returns immediately; poll ingest_status for progress.",
    parameters: {
      type: "object",
      properties: {
        liveOnly: { type: "boolean", description: "Only take in live stream VODs. Defaults to true." },
        limit: { type: "number", description: "Most videos to take in on this pass. Defaults to 3." },
        lookbackDays: { type: "number", description: "How many days back to look. Defaults to 7." }
      },
      additionalProperties: false
    },
    action: true
  },
  {
    name: "start_pipeline",
    description: "Put one explicit http(s) video URL through the Stream Pipeline. Use this when the user names a link; use start_channel_ingest when they mean 'whatever is new on my channel'.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http(s) source URL." },
        name: { type: "string", description: "A short name for the run." }
      },
      required: ["url"],
      additionalProperties: false
    },
    action: true
  },
  {
    name: "run_agent_team",
    description: `Hand a goal to the Sourceflow agent team. Specialists available: ${AGENT_REGISTRY.map((agent) => `${agent.id} (${agent.purpose})`).join("; ")}. Returns immediately; poll agent_run_status.`,
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What the team should achieve." },
        agentIds: {
          type: "array",
          items: { type: "string", enum: AGENT_REGISTRY.map((agent) => agent.id) },
          description: "Which specialists to run. Defaults to all of them."
        },
        provider: { type: "string", enum: ["chatgpt", "grok"], description: "Which brain the team runs on. Defaults to chatgpt." }
      },
      required: ["goal"],
      additionalProperties: false
    },
    action: true
  }
];

export function voiceToolDefinitions(allowActions: boolean) {
  return VOICE_TOOLS.filter((tool) => allowActions || !tool.action).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

const runIdSchema = z.object({ runId: z.string().trim().min(1) });
const optionalRunIdSchema = z.object({ runId: z.string().trim().min(1).optional() });
const scanSchema = z.object({
  liveOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(10).optional(),
  lookbackDays: z.number().int().min(1).max(60).optional()
});
const urlSchema = z.object({
  url: z.string().url().refine((value) => /^https?:\/\//i.test(value), "Only http(s) URLs are allowed."),
  name: z.string().trim().max(180).optional()
});
const teamSchema = z.object({
  goal: z.string().trim().min(1).max(20_000),
  agentIds: z.array(z.enum(["strategist", "researcher", "producer", "operator"])).min(1).max(4).optional(),
  provider: z.enum(["chatgpt", "grok"]).optional()
});

export type VoiceToolResult = { ok: true; [key: string]: unknown } | { ok: false; error: string };

export async function runVoiceTool(
  name: string,
  args: Record<string, unknown>,
  options: { allowActions: boolean; baseUrl?: string }
): Promise<VoiceToolResult> {
  const tool = VOICE_TOOLS.find((item) => item.name === name);
  if (!tool) return { ok: false, error: `There is no tool called ${name}.` };
  if (tool.action && !options.allowActions) {
    return { ok: false, error: "Actions are switched off for this session. Ask Nic to arm actions in the voice console, then try again." };
  }

  switch (tool.name) {
    case "sourceflow_state":
      return { ok: true, state: JSON.parse(await sourceflowContext()) as unknown };

    case "list_pipeline_runs": {
      const runs = await listRuns();
      return {
        ok: true,
        runs: runs.slice(0, 12).map((run) => ({
          id: run.id,
          name: run.name,
          status: run.status,
          sourceUrl: run.sourceUrl ?? null,
          createdAt: run.createdAt
        }))
      };
    }

    case "pipeline_run_status": {
      const { runId } = runIdSchema.parse(args);
      const run = await getRun(runId);
      if (!run) return { ok: false, error: `No pipeline run called ${runId}.` };
      const overview = await runOverview(run, overviewContext());
      return { ok: true, run: { id: run.id, name: run.name, status: run.status }, stages: overview.stages, schedulable: overview.schedulable };
    }

    case "channel_check": {
      const input = scanSchema.parse(args);
      const job = startIngestScan({ ...input, dryRun: true, baseUrl: options.baseUrl });
      return { ok: true, started: job.id, note: "The channel check is running. Call ingest_status in a few seconds for the report." };
    }

    case "ingest_status":
      return { ok: true, ingest: await ingestOverview() };

    case "agent_run_status": {
      const { runId } = optionalRunIdSchema.parse(args);
      const run = runId ? await getAgentRun(runId) : (await listAgentRuns())[0] ?? null;
      if (!run) return { ok: false, error: runId ? `No agent run called ${runId}.` : "No agent team has run yet." };
      return {
        ok: true,
        run: {
          id: run.id,
          goal: run.goal,
          status: run.status,
          steps: run.steps.map((step) => ({ label: step.label, status: step.status, summary: step.summary ?? step.error ?? null })),
          answer: run.answer,
          actionsAwaitingApproval: run.actions.filter((action) => action.status === "proposed").map((action) => action.title),
          error: run.error ?? null
        }
      };
    }

    case "start_channel_ingest": {
      const input = scanSchema.parse(args);
      const job = startIngestScan({ ...input, dryRun: false, baseUrl: options.baseUrl });
      return {
        ok: true,
        started: job.id,
        note: "The scan is running in the app. It fans every new stream out into clips, the long-form edit, the podcast MP3, the carousel and the text posts, and stops at ready to schedule. Nothing is published. Poll ingest_status."
      };
    }

    case "start_pipeline": {
      const input = urlSchema.parse(args);
      const run = await createRunFromUrl(input.url, input.name);
      return { ok: true, runId: run.id, note: "The pipeline run started. Poll pipeline_run_status." };
    }

    case "run_agent_team": {
      const input = teamSchema.parse(args);
      const runId = newAgentRunId();
      void runAgentTeam({
        runId,
        goal: input.goal,
        provider: input.provider ?? "chatgpt",
        agentIds: input.agentIds ?? AGENT_REGISTRY.map((agent) => agent.id)
      }).catch(() => {});
      return { ok: true, runId, note: "The agent team is working. Poll agent_run_status. Anything it wants to change waits in the approval inbox." };
    }

    default:
      return { ok: false, error: `Tool ${tool.name} has no handler.` };
  }
}
