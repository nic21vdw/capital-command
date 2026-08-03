import { runAi } from "@/lib/ai";
import type { AiMessage } from "@/lib/ai";
import { voiceInstructions } from "@/lib/voice/prompt";
import { VOICE_TOOLS, runVoiceTool } from "@/lib/voice/tools";

const MAX_ROUNDS = 3;
const FENCE = "capital";

export type VoiceToolRun = { name: string; args: Record<string, unknown>; result: unknown };
export type VoiceTurn = { reply: string; toolRuns: VoiceToolRun[] };

export type ToolRequest = { name: string; args: Record<string, unknown> };

/**
 * The free gateway has no native tool calling, so tools ride a fenced block:
 * one JSON object per line inside ```capital. The block is stripped from what
 * gets spoken — the engineer hears the prose, never the protocol.
 */
export function parseToolBlock(text: string): { prose: string; calls: ToolRequest[] } {
  const fence = new RegExp("```" + FENCE + "\\s*([\\s\\S]*?)```", "gi");
  const calls: ToolRequest[] = [];
  const prose = text
    .replace(fence, (_match, body: string) => {
      for (const line of String(body).split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as { tool?: unknown; args?: unknown };
          const name = typeof parsed.tool === "string" ? parsed.tool : "";
          if (!name) continue;
          calls.push({
            name,
            args: parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
              ? (parsed.args as Record<string, unknown>)
              : {}
          });
        } catch {
          continue;
        }
      }
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return { prose, calls };
}

function protocolPrompt(allowActions: boolean): string {
  const names = VOICE_TOOLS.filter((tool) => allowActions || !tool.action).map((tool) => tool.name);
  return [
    `You are speaking out loud, so answer in one or two plain sentences. No markdown, no lists, no ids read aloud unless asked.`,
    `To use a tool, end your message with a fenced block like this and nothing after it:`,
    "```" + FENCE,
    `{"tool":"channel_check","args":{}}`,
    "```",
    `One JSON object per line, at most two calls per turn. Available tools: ${names.join(", ")}.`,
    `The block is stripped before anything is spoken, so put what you want said in the prose above it. When a tool result comes back, answer from it — do not call the same tool again unless the answer needs it.`
  ].join("\n");
}

function describeResults(runs: VoiceToolRun[]): string {
  return runs.map((run) => `${run.name} returned: ${JSON.stringify(run.result).slice(0, 4000)}`).join("\n\n");
}

/**
 * One spoken turn: dictated text in, prose to speak out, with any allowed tools
 * run in between. Rounds are capped so a model that keeps calling tools cannot
 * spin.
 */
export async function runVoiceTurn(input: {
  utterance: string;
  history?: AiMessage[];
  allowActions: boolean;
  baseUrl?: string;
}): Promise<VoiceTurn> {
  const utterance = input.utterance.trim();
  if (!utterance) return { reply: "", toolRuns: [] };

  const system = `${await voiceInstructions(input.allowActions)}\n\n${protocolPrompt(input.allowActions)}`;
  const messages: AiMessage[] = [...(input.history ?? []).slice(-6), { role: "user", content: utterance }];
  const toolRuns: VoiceToolRun[] = [];
  let spoken = "";

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const result = await runAi({ system, messages, temperature: 0.3 });
    if (!result) {
      return {
        reply: spoken || "I could not reach the model just now. Try again in a moment.",
        toolRuns
      };
    }
    const { prose, calls } = parseToolBlock(result.text);
    if (prose) spoken = prose;
    if (!calls.length) break;

    const runs: VoiceToolRun[] = [];
    for (const call of calls.slice(0, 2)) {
      const value = await runVoiceTool(call.name, call.args, {
        allowActions: input.allowActions,
        baseUrl: input.baseUrl
      }).catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : "The tool failed."
      }));
      runs.push({ name: call.name, args: call.args, result: value });
    }
    toolRuns.push(...runs);
    messages.push({ role: "assistant", content: result.text });
    messages.push({ role: "user", content: `Tool results:\n${describeResults(runs)}\n\nNow answer me out loud.` });
  }

  return { reply: spoken || "Done.", toolRuns };
}
