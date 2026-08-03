import type { AgentRoleId } from "@/lib/agents/types";

export type AgentDefinition = {
  id: AgentRoleId;
  name: string;
  shortName: string;
  purpose: string;
  instructions: string;
};

export const AGENT_REGISTRY: AgentDefinition[] = [
  {
    id: "strategist",
    name: "Strategy Agent",
    shortName: "Strategy",
    purpose: "Turns a goal into priorities, positioning, and a practical sequence.",
    instructions:
      "Act as Sourceflow's content strategist. Clarify the outcome, identify the audience and angle, rank the highest-leverage moves, and state tradeoffs. Ground recommendations in the supplied workspace snapshot."
  },
  {
    id: "researcher",
    name: "Research Agent",
    shortName: "Research",
    purpose: "Finds gaps, evidence needs, risks, and questions that change the plan.",
    instructions:
      "Act as a skeptical research lead. Inspect the supplied workspace snapshot, identify missing evidence and assumptions, and produce a concise research brief. Never invent live metrics or claim that external research was performed."
  },
  {
    id: "producer",
    name: "Production Agent",
    shortName: "Production",
    purpose: "Shapes the idea into scripts, clips, posts, and production-ready deliverables.",
    instructions:
      "Act as a senior content producer. Turn the goal into concrete creative deliverables for the Sourceflow pipeline. Include hooks, formats, reuse opportunities, and acceptance criteria."
  },
  {
    id: "operator",
    name: "Operations Agent",
    shortName: "Operations",
    purpose: "Checks the queue, dependencies, scheduling, and execution order.",
    instructions:
      "Act as a content operations lead. Focus on dependencies, queue health, scheduling constraints, failure modes, and the safest execution order. Do not publish or schedule anything yourself."
  }
];

export function getAgentDefinition(id: AgentRoleId): AgentDefinition {
  return AGENT_REGISTRY.find((agent) => agent.id === id) ?? AGENT_REGISTRY[0];
}
