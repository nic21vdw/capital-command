import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeAgentAction } from "@/lib/agents/actions";
import { getAgentRun, saveAgentRun } from "@/lib/agents/store";
import type { AgentRun } from "@/lib/agents/types";
import { PATCH } from "./route";

vi.mock("@/lib/agents/actions", () => ({ executeAgentAction: vi.fn() }));

let runId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(executeAgentAction).mockResolvedValue("Saved draft.");
  runId = `review-${crypto.randomUUID()}`;
  const run: AgentRun = {
    id: runId, goal: "Plan content", provider: "chatgpt", model: "test", agentIds: ["producer"],
    status: "completed", createdAt: "2026-10-02T12:00:00Z", updatedAt: "2026-10-02T12:00:00Z", steps: [], answer: "Drafts ready",
    actions: ["first", "second"].map((id) => ({
      id, type: "save_content_idea", title: id, reason: "Save a draft", payload: { title: id }, status: "proposed"
    }))
  };
  await saveAgentRun(run);
});

function review(actionId: string, decision = "approve") {
  return PATCH(new NextRequest("http://localhost/api/agents/review", {
    method: "PATCH", body: JSON.stringify({ decision })
  }), { params: Promise.resolve({ runId, actionId }) });
}

describe("agent action decisions", () => {
  it("executes a rapidly repeated approval once", async () => {
    const responses = await Promise.all([review("first"), review("first")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(executeAgentAction).toHaveBeenCalledTimes(1);
    expect((await getAgentRun(runId))?.actions[0].status).toBe("approved");
  });

  it("preserves two concurrent decisions on different actions in one run", async () => {
    const responses = await Promise.all([review("first"), review("second", "reject")]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await getAgentRun(runId))?.actions.map((action) => action.status)).toEqual(["approved", "rejected"]);
    expect(executeAgentAction).toHaveBeenCalledTimes(1);
  });

  it("records an execution failure without allowing a repeated click to rerun it", async () => {
    vi.mocked(executeAgentAction).mockRejectedValueOnce(new Error("Source unavailable"));
    expect((await review("first")).status).toBe(200);
    expect((await getAgentRun(runId))?.actions[0]).toMatchObject({ status: "failed", result: "Source unavailable" });
    expect((await review("first")).status).toBe(409);
    expect(executeAgentAction).toHaveBeenCalledTimes(1);
  });
});
