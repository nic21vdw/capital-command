export type AgentProviderId = "chatgpt" | "grok";

export type AgentRoleId = "strategist" | "researcher" | "producer" | "operator";

export type AgentActionType = "save_content_idea" | "start_pipeline";

export type AgentActionStatus = "proposed" | "approved" | "rejected" | "failed";

export type AgentAction = {
  id: string;
  type: AgentActionType;
  title: string;
  reason: string;
  payload: Record<string, unknown>;
  status: AgentActionStatus;
  result?: string;
};

export type AgentStep = {
  id: string;
  agentId: AgentRoleId | "director";
  label: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  output?: string;
  error?: string;
};

export type AgentRun = {
  id: string;
  goal: string;
  provider: AgentProviderId;
  model: string;
  agentIds: AgentRoleId[];
  status: "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  steps: AgentStep[];
  answer: string;
  actions: AgentAction[];
  error?: string;
};

export type WorkerResult = {
  summary: string;
  deliverable: string;
  proposedActions: Array<{
    type: AgentActionType;
    title: string;
    reason: string;
    payload: Record<string, unknown>;
  }>;
};
