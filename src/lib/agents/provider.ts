import type { AgentProviderId, WorkerResult } from "@/lib/agents/types";

type ProviderConfig = {
  id: AgentProviderId;
  label: string;
  model: string;
  endpoint: string;
  key: string | undefined;
};

function configuredValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function providerConfig(id: AgentProviderId): ProviderConfig {
  if (id === "grok") {
    return {
      id,
      label: "Grok",
      model: configuredValue("XAI_AGENT_MODEL") ?? "grok-4.5",
      endpoint: (configuredValue("XAI_BASE_URL") ?? "https://api.x.ai/v1").replace(/\/+$/, ""),
      key: configuredValue("XAI_API_KEY")
    };
  }
  return {
    id,
    label: "ChatGPT",
    model: configuredValue("OPENAI_AGENT_MODEL") ?? "gpt-5.2",
    endpoint: (configuredValue("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    key: configuredValue("OPENAI_API_KEY")
  };
}

export function providerStatus() {
  return (["chatgpt", "grok"] as const).map((id) => {
    const config = providerConfig(id);
    return { id, label: config.label, model: config.model, configured: Boolean(config.key) };
  });
}

function textFromResponse(data: unknown): string {
  const choice = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : ""))
      .join("\n");
  }
  return "";
}

function jsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(candidate) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The model returned invalid JSON.");
  return parsed as Record<string, unknown>;
}

export async function callAgentModel(
  provider: AgentProviderId,
  system: string,
  prompt: string
): Promise<{ text: string; model: string }> {
  const config = providerConfig(provider);
  if (!config.key) {
    throw new Error(`${config.label} is not configured. Add ${provider === "grok" ? "XAI_API_KEY" : "OPENAI_API_KEY"} to .env.`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ],
        max_completion_tokens: 5000
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`${config.label} returned ${response.status}${detail ? `: ${detail}` : "."}`);
    }
    const text = textFromResponse(await response.json()).trim();
    if (!text) throw new Error(`${config.label} returned an empty response.`);
    return { text, model: config.model };
  } finally {
    clearTimeout(timer);
  }
}

export async function callWorker(
  provider: AgentProviderId,
  system: string,
  prompt: string
): Promise<{ result: WorkerResult; model: string }> {
  const requested = `${prompt}\n\nReturn one JSON object with this exact shape:\n{\n  "summary": "short status summary",\n  "deliverable": "complete markdown deliverable",\n  "proposedActions": [\n    { "type": "save_content_idea | start_pipeline", "title": "human-readable action", "reason": "why it helps", "payload": {} }\n  ]\n}\nOnly propose save_content_idea when a durable idea should be added. Its payload must contain title, notes, type (Video, Short, Stream, or Podcast), and platform (YouTube, Twitch, TikTok, Instagram, or Other). Only propose start_pipeline when the user supplied an explicit http(s) source URL. Its payload must contain url and may contain name. Use an empty proposedActions array when no state change is needed. Never claim an action was executed.`;
  const response = await callAgentModel(provider, system, requested);
  const parsed = jsonObject(response.text);
  return {
    model: response.model,
    result: {
      summary: String(parsed.summary ?? "").trim(),
      deliverable: String(parsed.deliverable ?? "").trim(),
      proposedActions: Array.isArray(parsed.proposedActions)
        ? (parsed.proposedActions as WorkerResult["proposedActions"])
        : []
    }
  };
}
