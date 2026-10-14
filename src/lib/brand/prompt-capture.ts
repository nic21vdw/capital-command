import type { CapturedPrompt } from "@/lib/brand/prompt-cases";

const store: CapturedPrompt[] = [];

export function captureRequest(request: { system?: string; messages: Array<{ content: string }> }) {
  store.push({ system: request.system ?? "", user: request.messages.map((message) => message.content).join("\n\n") });
}

export function captureText(text: string) {
  store.push({ system: text, user: "" });
}

export function takeCaptured(): CapturedPrompt[] {
  return store.splice(0, store.length);
}
