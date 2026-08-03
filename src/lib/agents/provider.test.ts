import { afterEach, describe, expect, it, vi } from "vitest";
import { callAgentModel, callWorker, providerConfig, providerStatus } from "@/lib/agents/provider";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("agent providers", () => {
  it("reports provider readiness without exposing keys", () => {
    vi.stubEnv("OPENAI_API_KEY", "secret-openai");
    const statuses = providerStatus();
    expect(statuses.find((item) => item.id === "chatgpt")?.configured).toBe(true);
    expect(JSON.stringify(statuses)).not.toContain("secret-openai");
    expect(providerConfig("grok").model).toBe("grok-4.5");
  });

  it("routes ChatGPT requests through the configured server endpoint", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://local.example/v1/");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Ready" } }] }), { status: 200 })
    );
    const result = await callAgentModel("chatgpt", "system", "goal");
    expect(result.text).toBe("Ready");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://local.example/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect((request.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("parses a fenced worker result and keeps proposed actions reviewable", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '```json\n{"summary":"Found an angle","deliverable":"Draft plan","proposedActions":[{"type":"save_content_idea","title":"Save it","reason":"Useful","payload":{"title":"Agent workflows","notes":"Draft","type":"Video","platform":"YouTube"}}]}\n```'
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    const result = await callWorker("grok", "system", "goal");
    expect(result.result.summary).toBe("Found an angle");
    expect(result.result.proposedActions[0].type).toBe("save_content_idea");
  });
});
