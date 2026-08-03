import { describe, expect, it } from "vitest";
import { executeAgentAction, normalizeProposedActions } from "@/lib/agents/actions";
import { readAppData } from "@/lib/storage/store";

describe("agent action approval boundary", () => {
  it("drops unknown and malformed actions before they reach the approval inbox", () => {
    const actions = normalizeProposedActions([
      {
        type: "start_pipeline",
        title: "Read a local file",
        reason: "unsafe",
        payload: { url: "file:///tokens.txt" }
      },
      {
        type: "delete_everything" as "save_content_idea",
        title: "Delete",
        reason: "unsafe",
        payload: {}
      }
    ]);
    expect(actions).toEqual([]);
  });

  it("saves a draft idea only after the approved action executor runs", async () => {
    const [action] = normalizeProposedActions([
      {
        type: "save_content_idea",
        title: "Save a video idea",
        reason: "The plan needs a durable next step.",
        payload: {
          title: "How agent teams run a content pipeline",
          notes: "AI-assisted draft",
          type: "Video",
          platform: "YouTube"
        }
      }
    ]);
    const result = await executeAgentAction(action);
    const data = await readAppData();
    expect(result).toMatch(/^Saved content idea /);
    expect(data.contentItems[0]).toMatchObject({
      title: "How agent teams run a content pipeline",
      status: "Idea",
      platform: "YouTube"
    });
  });
});
