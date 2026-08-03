import { z } from "zod";
import { createRunFromUrl } from "@/lib/pipeline/runs";
import { readAppData, writeAppData } from "@/lib/storage/store";
import type { AgentAction, AgentActionType, WorkerResult } from "@/lib/agents/types";

const ideaSchema = z.object({
  title: z.string().trim().min(1).max(180),
  notes: z.string().trim().max(5000).default(""),
  type: z.enum(["Video", "Short", "Stream", "Podcast"]).default("Video"),
  platform: z.enum(["YouTube", "Twitch", "TikTok", "Instagram", "Other"]).default("YouTube")
});

const pipelineSchema = z.object({
  url: z.string().url().refine((value) => /^https?:\/\//i.test(value), "Only http(s) URLs are allowed."),
  name: z.string().trim().max(180).optional()
});

const ACTION_TYPES: AgentActionType[] = ["save_content_idea", "start_pipeline"];

export function normalizeProposedActions(actions: WorkerResult["proposedActions"]): AgentAction[] {
  return actions.flatMap((action) => {
    if (!action || !ACTION_TYPES.includes(action.type)) return [];
    const parsed = action.type === "save_content_idea" ? ideaSchema.safeParse(action.payload) : pipelineSchema.safeParse(action.payload);
    if (!parsed.success) return [];
    return [
      {
        id: `action-${crypto.randomUUID()}`,
        type: action.type,
        title: String(action.title || action.type).slice(0, 180),
        reason: String(action.reason || "Proposed by an agent.").slice(0, 1000),
        payload: parsed.data,
        status: "proposed" as const
      }
    ];
  });
}

export async function executeAgentAction(action: AgentAction): Promise<string> {
  if (action.type === "save_content_idea") {
    const input = ideaSchema.parse(action.payload);
    const data = await readAppData();
    const now = new Date().toISOString();
    const id = `content-${crypto.randomUUID()}`;
    await writeAppData({
      ...data,
      contentItems: [
        {
          id,
          title: input.title,
          type: input.type,
          platform: input.platform,
          status: "Idea",
          notes: input.notes,
          createdAt: now,
          updatedAt: now
        },
        ...data.contentItems
      ]
    });
    return `Saved content idea ${id}.`;
  }
  const input = pipelineSchema.parse(action.payload);
  const run = await createRunFromUrl(input.url, input.name);
  return `Started pipeline run ${run.id}.`;
}
