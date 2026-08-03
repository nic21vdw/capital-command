import { normalizeProposedActions } from "@/lib/agents/actions";
import { sourceflowContext } from "@/lib/agents/context";
import { callAgentModel, callWorker, providerConfig } from "@/lib/agents/provider";
import { getAgentDefinition } from "@/lib/agents/registry";
import { saveAgentRun } from "@/lib/agents/store";
import type { AgentAction, AgentProviderId, AgentRoleId, AgentRun, AgentStep, WorkerResult } from "@/lib/agents/types";

const SAFETY_PROMPT = `You are an agent working inside Sourceflow, Nic's private content operations system. You may inspect the supplied snapshot and prepare useful work. You must never claim that you published, scheduled, deleted, or changed anything. State-changing work must be proposed for human approval. Do not expose secrets or ask for tokens. Do not invent workspace facts.`;

export async function runAgentTeam(input: {
  goal: string;
  provider: AgentProviderId;
  agentIds: AgentRoleId[];
}): Promise<AgentRun> {
  const goal = input.goal.trim();
  if (!goal) throw new Error("Describe what the agent team should achieve.");
  const ids = [...new Set(input.agentIds)].slice(0, 4);
  if (ids.length === 0) throw new Error("Choose at least one agent.");
  const now = new Date().toISOString();
  const config = providerConfig(input.provider);
  let run: AgentRun = {
    id: `agent-run-${crypto.randomUUID()}`,
    goal,
    provider: input.provider,
    model: config.model,
    agentIds: ids,
    status: "running",
    createdAt: now,
    updatedAt: now,
    answer: "",
    actions: [],
    steps: ids.map((id) => ({ id: `step-${crypto.randomUUID()}`, agentId: id, label: getAgentDefinition(id).name, status: "queued" }))
  };
  await saveAgentRun(run);

  try {
    const context = await sourceflowContext();
    run = {
      ...run,
      steps: run.steps.map((step) => ({ ...step, status: "running", startedAt: new Date().toISOString() })),
      updatedAt: new Date().toISOString()
    };
    await saveAgentRun(run);

    const settled = await Promise.allSettled(
      ids.map(async (id) => {
        const definition = getAgentDefinition(id);
        return callWorker(
          input.provider,
          `${SAFETY_PROMPT}\n\n${definition.instructions}`,
          `User goal:\n${goal}\n\nCurrent Sourceflow snapshot:\n${context}`
        );
      })
    );

    const results: Array<{ id: AgentRoleId; result: WorkerResult }> = [];
    const steps: AgentStep[] = run.steps.map((step, index) => {
      const item = settled[index];
      if (item.status === "fulfilled") {
        results.push({ id: ids[index], result: item.value.result });
        return {
          ...step,
          status: "completed",
          finishedAt: new Date().toISOString(),
          summary: item.value.result.summary,
          output: item.value.result.deliverable
        };
      }
      return {
        ...step,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: item.reason instanceof Error ? item.reason.message : String(item.reason)
      };
    });
    if (results.length === 0) {
      const error = steps.map((step) => step.error).filter(Boolean).join(" ") || "Every agent failed.";
      run = { ...run, steps, status: "failed", error, updatedAt: new Date().toISOString() };
      await saveAgentRun(run);
      return run;
    }

    let answer = results[0].result.deliverable;
    const directorStep: AgentStep = {
      id: `step-${crypto.randomUUID()}`,
      agentId: "director",
      label: "Orchestrator",
      status: "completed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    if (results.length > 1) {
      const synthesis = await callAgentModel(
        input.provider,
        `${SAFETY_PROMPT}\n\nYou are the Sourceflow orchestrator. Reconcile specialist work into one direct answer. Remove duplication, surface disagreements, preserve concrete deliverables, and finish with a short recommended sequence. Do not add actions that the specialists did not propose.`,
        `User goal:\n${goal}\n\nSpecialist work:\n${results.map((item) => `## ${getAgentDefinition(item.id).name}\n${item.result.deliverable}`).join("\n\n")}`
      );
      answer = synthesis.text;
      run.model = synthesis.model;
      directorStep.summary = "Combined the specialist outputs into one plan.";
      directorStep.output = answer;
    } else {
      directorStep.summary = "Returned the selected specialist's deliverable.";
      directorStep.output = answer;
    }
    const actions: AgentAction[] = results.flatMap((item) => normalizeProposedActions(item.result.proposedActions));
    run = {
      ...run,
      steps: [...steps, directorStep],
      status: "completed",
      answer,
      actions,
      updatedAt: new Date().toISOString()
    };
    await saveAgentRun(run);
    return run;
  } catch (error) {
    run = {
      ...run,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString()
    };
    await saveAgentRun(run);
    return run;
  }
}
