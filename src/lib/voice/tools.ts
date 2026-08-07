import { z } from "zod";
import { sourceflowContext } from "@/lib/agents/context";
import { newAgentRunId, runAgentTeam } from "@/lib/agents/orchestrator";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import { getAgentRun, listAgentRuns } from "@/lib/agents/store";
import { explainDecision } from "@/lib/ingest/classify";
import { ingestOverview, listIngestJobs, startIngestScan } from "@/lib/ingest/service";
import type { IngestJob } from "@/lib/ingest/service";
import type { ScanCandidate } from "@/lib/ingest/types";
import { renderNextSegment, repairRun } from "@/lib/pipeline/repair";
import { REPAIRABLE_STAGES } from "@/lib/pipeline/repairable";
import { createRunFromUrl, getRun, listRuns, runOverview } from "@/lib/pipeline/runs";
import type { PipelineRun } from "@/lib/pipeline/types";
import { SCREENS, findScreen, screenHref } from "@/lib/voice/screens";

export type VoiceToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  action: boolean;
};

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false } as const;

export const VOICE_TOOLS: VoiceToolDefinition[] = [
  {
    name: "open_screen",
    description: `Take Nic to a screen — this is how you SHOW him something rather than describing it. Call it whenever he says show me, take me to, pull up, open, or go to. Screens: ${SCREENS.map(
      (screen) => `${screen.id} (${screen.purpose})`
    ).join("; ")}. With target pipeline, pass runId — or runName, part of the run's name — to open that one run.`,
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Which screen, by id." },
        runId: { type: "string", description: "Optional pipeline run id to open." },
        runName: { type: "string", description: "Optional part of a pipeline run's name, when the user names the stream instead of an id." }
      },
      required: ["target"],
      additionalProperties: false
    },
    action: false
  },
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
    description: "Report one Stream Pipeline run in detail: every stage, what is ready to schedule, what is still working, and which stages can be retried. Identify the run by id or by part of its name. Reading a run also advances it.",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The pipeline run id." },
        runName: { type: "string", description: "Part of the run's name, e.g. 'Day 28'. Use this when the user names the stream instead of an id." }
      },
      additionalProperties: false
    },
    action: false
  },
  {
    name: "channel_check",
    description: "Look at the YouTube channel and report which recent uploads are new to the pipeline and which are skipped and why. This is the dry run — it changes nothing. Read the result with ingest_status: every skipped upload comes back with its URL and an overridable flag, and an overridable one can be taken in on the spot by calling start_pipeline with that URL. Offer that instead of leaving him with a list.",
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
    description: "Report the channel ingest ledger — what has already been taken in — plus the most recent scan or check: its log, what it found new, and every upload it skipped with the reason, the URL and whether that skip is one a person can override.",
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
    name: "retry_pipeline_stage",
    description: `Actually fix a stuck or failed stage of a pipeline run: re-export the long-form video, re-cut the podcast MP3, re-split the topic segments, re-render missing clips, rewrite the carousel or the text posts. Stages: ${REPAIRABLE_STAGES.join(", ")}. Call pipeline_run_status first — it lists exactly which stages can be retried. This starts real work; it never publishes.`,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The pipeline run id." },
        runName: { type: "string", description: "Part of the run's name, when the user named the stream." },
        stage: { type: "string", enum: [...REPAIRABLE_STAGES], description: "Which stage to run again." }
      },
      required: ["stage"],
      additionalProperties: false
    },
    action: true
  },
  {
    name: "render_topic_segment",
    description: "Render the next planned topic segment of a run as its own long-form video. Segments are planned automatically but rendered on demand, one at a time — call it again for the next one.",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The pipeline run id." },
        runName: { type: "string", description: "Part of the run's name, when the user named the stream." }
      },
      additionalProperties: false
    },
    action: true
  },
  {
    name: "start_channel_ingest",
    description: "Scan the YouTube channel and put every new stream through the whole Stream Pipeline unattended, stopping at ready-to-schedule. It only schedules anything if Nic has turned on overnight scheduling in Settings; you never publish anything yourself. Returns immediately; poll ingest_status for progress.",
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
    description: "Put one explicit http(s) video URL through the Stream Pipeline. Use this when the user names a link, and also to take in a single upload the channel check skipped — the URL is in the check's report. Use start_channel_ingest when they mean 'whatever is new on my channel'.",
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

const optionalRunIdSchema = z.object({ runId: z.string().trim().min(1).optional() });
const stageSchema = z.object({ stage: z.enum(REPAIRABLE_STAGES) });

export type RunReference = { runId?: string; name?: string };

/**
 * Which run the model meant, whatever it called the argument. Small models
 * reach for runName, run, title or name for the same thing, and a stripped
 * argument is worse than a wrong one here: it silently falls through to the
 * most recent run, which is a different stream.
 */
export function runReferenceFrom(args: Record<string, unknown>): RunReference {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  return {
    runId: text(args.runId) ?? text(args.id),
    name: text(args.runName) ?? text(args.name) ?? text(args.run) ?? text(args.title)
  };
}

/**
 * Starting work also says where to watch it. Same `href`/`label` contract
 * `open_screen` uses, so the command bar takes Nic to the thing it just started
 * without a second tool call — a tool that hands back only an id leaves him on
 * whatever screen he was already on.
 */
export function toolDestination(screenId: string, runId?: string): { href: string; label: string } {
  const screen = findScreen(screenId);
  if (!screen) return { href: "/", label: "Dashboard" };
  return { href: screenHref(screen, runId), label: screen.label };
}

function runHref(runId: string): { href: string; label: string } {
  return toolDestination("pipeline", runId);
}

/**
 * Skips a person can reasonably overturn. The scan holds these back because it
 * is unattended and cautious, not because the video is wrong — so the report
 * hands back the URL and the orchestrator can offer to run it through
 * start_pipeline. The other skips stay dead ends on purpose: this app's own
 * uploads are the tail-eating bug the scan exists to prevent, a private video
 * is a draft, and a vertical Short is a Short.
 */
export const OVERRIDABLE_SKIPS = new Set([
  "not-a-live-stream",
  "probable-short-unknown-aspect",
  "already-ingested",
  "already-in-the-pipeline"
]);

export type SkippedUpload = {
  videoId: string;
  title: string;
  url: string;
  reason: string;
  overridable: boolean;
};

export function describeSkips(candidates: readonly ScanCandidate[]): SkippedUpload[] {
  return candidates
    .filter((candidate) => candidate.decision.action === "skip")
    .map((candidate) => ({
      videoId: candidate.upload.videoId,
      title: candidate.upload.title,
      url: candidate.upload.url,
      reason: explainDecision(candidate.decision),
      overridable: OVERRIDABLE_SKIPS.has(candidate.decision.reason)
    }));
}

/**
 * The scan report as the orchestrator needs it. `ingestOverview` only carries a
 * report while the job is RUNNING, so a dry run that finished a second ago had
 * nothing left to report — the check was a dead end even before the skips were.
 */
export function describeScanJob(job: IngestJob | null) {
  if (!job) return null;
  const report = job.report;
  return {
    id: job.id,
    status: job.status,
    dryRun: job.dryRun,
    finishedAt: job.finishedAt,
    error: job.error,
    log: job.log.slice(-20),
    newToThePipeline:
      report?.candidates
        .filter((candidate) => candidate.decision.action === "ingest")
        .map((candidate) => ({
          videoId: candidate.upload.videoId,
          title: candidate.upload.title,
          url: candidate.upload.url,
          reason: explainDecision(candidate.decision)
        })) ?? [],
    skipped: report ? describeSkips(report.candidates) : []
  };
}

/**
 * Finds the run the user means. Nic names streams ("Day 28"), not ids, and an
 * orchestrator that needs an id read to it is one that makes him do the work.
 * An ambiguous name comes back as a question, never as a guess.
 */
async function resolvePipelineRun(
  ref: { runId?: string; name?: string }
): Promise<{ ok: true; run: PipelineRun } | { ok: false; error: string }> {
  if (ref.runId) {
    const run = await getRun(ref.runId);
    if (run) return { ok: true, run };
    if (!ref.name) return { ok: false, error: `No pipeline run called ${ref.runId}.` };
  }
  const all = await listRuns();
  const needle = (ref.name ?? ref.runId ?? "").toLowerCase().trim();
  if (!needle) {
    if (all.length === 0) return { ok: false, error: "There are no pipeline runs yet." };
    return { ok: true, run: all[0] };
  }
  const matches = all.filter(
    (run) => run.id.toLowerCase() === needle || run.name.toLowerCase().includes(needle)
  );
  if (matches.length === 1) return { ok: true, run: matches[0] };
  if (matches.length > 1) {
    // Most recent wins only when one name is a clear prefix; otherwise ask.
    const exact = matches.filter((run) => run.name.toLowerCase() === needle);
    if (exact.length === 1) return { ok: true, run: exact[0] };
    return {
      ok: false,
      error: `Several runs match "${ref.name ?? ref.runId}": ${matches.slice(0, 5).map((run) => run.name).join("; ")}. Ask which one.`
    };
  }
  return { ok: false, error: `No pipeline run matches "${ref.name ?? ref.runId}".` };
}
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
    case "open_screen": {
      // A small model names this argument whatever it feels like — screen,
      // page, to. Refusing on the key rather than the value would make
      // navigation flaky for no reason.
      const named = args as Record<string, unknown>;
      const target = String(named.target ?? named.screen ?? named.page ?? named.name ?? named.to ?? "");
      const screen = findScreen(target);
      if (!screen) {
        return { ok: false, error: `There is no screen called ${target}. Try one of: ${SCREENS.map((item) => item.id).join(", ")}.` };
      }
      // Nic says the stream's name, not its id, so a named run is looked up the
      // same way the pipeline tools look it up. `name` is deliberately not read
      // as a run here — on this tool it is one of the ways the model spells the
      // screen.
      const runRef = { runId: named.runId, runName: named.runName };
      let runId: string | undefined;
      if (runRef.runId || runRef.runName) {
        const found = await resolvePipelineRun(runReferenceFrom(runRef));
        if (!found.ok) return found;
        runId = found.run.id;
      }
      // The href is what the command bar navigates to — the tool cannot move
      // the browser itself, it can only say where to go.
      return { ok: true, href: screenHref(screen, runId), label: screen.label, opened: screen.id };
    }

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
      const found = await resolvePipelineRun(runReferenceFrom(args));
      if (!found.ok) return found;
      const overview = await runOverview(found.run);
      return {
        ok: true,
        run: { id: found.run.id, name: found.run.name, status: found.run.status },
        stages: overview.stages,
        schedulable: overview.schedulable,
        settled: overview.settled,
        retryableStages: overview.retryable
      };
    }

    case "retry_pipeline_stage": {
      const { stage } = stageSchema.parse(args);
      const found = await resolvePipelineRun(runReferenceFrom(args));
      if (!found.ok) return found;
      const result = await repairRun(found.run.id, stage);
      if (!result.ok) return result;
      return {
        ok: true,
        run: { id: found.run.id, name: found.run.name },
        stage: result.stage,
        detail: result.detail,
        ...runHref(found.run.id)
      };
    }

    case "render_topic_segment": {
      const found = await resolvePipelineRun(runReferenceFrom(args));
      if (!found.ok) return found;
      const result = await renderNextSegment(found.run.id);
      if (!result.ok) return result;
      return {
        ok: true,
        rendering: result.title,
        remaining: result.remaining,
        ...runHref(found.run.id)
      };
    }

    case "channel_check": {
      const input = scanSchema.parse(args);
      const job = startIngestScan({ ...input, dryRun: true, baseUrl: options.baseUrl });
      return {
        ok: true,
        started: job.id,
        note: "The channel check is running. Call ingest_status in a few seconds for the report — it lists every skipped upload with its URL, and the ones marked overridable can be taken in with start_pipeline on that URL.",
        ...toolDestination("agents")
      };
    }

    case "ingest_status":
      return { ok: true, ingest: await ingestOverview(), lastScan: describeScanJob(listIngestJobs()[0] ?? null) };

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
        note: "The scan is running in the app. It fans every new stream out into clips, the long-form edit, the podcast MP3, the carousel and the text posts. It stops at ready to schedule unless overnight scheduling is on in Settings, in which case the run books its own outputs into the queues that post. Poll ingest_status.",
        ...toolDestination("agents")
      };
    }

    case "start_pipeline": {
      const input = urlSchema.parse(args);
      const run = await createRunFromUrl(input.url, input.name);
      return { ok: true, runId: run.id, note: "The pipeline run started. Poll pipeline_run_status.", ...runHref(run.id) };
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
      return {
        ok: true,
        runId,
        note: "The agent team is working. Poll agent_run_status. Anything it wants to change waits in the approval inbox.",
        ...toolDestination("agents")
      };
    }

    default:
      return { ok: false, error: `Tool ${tool.name} has no handler.` };
  }
}
