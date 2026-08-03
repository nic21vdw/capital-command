export type VoiceSessionPayload = {
  grantId: string;
  provider: string;
  label: string;
  model: string;
  voice: string;
  socketUrl: string;
  subprotocols: string[];
  sessionUpdate: Record<string, unknown>;
  allowActions: boolean;
};

export type VoiceStatus = "idle" | "connecting" | "live" | "listening" | "thinking";

export type VoiceTranscript = { role: "user" | "assistant"; text: string; final: boolean };

export type VoiceToolEvent = { name: string; arguments: Record<string, unknown>; result: unknown };

type FunctionCall = { callId: string; name: string; argumentsText: string };

export function functionCallsFromResponse(payload: unknown): FunctionCall[] {
  const output = (payload as { response?: { output?: unknown[] } })?.response?.output ?? [];
  return output
    .filter((item): item is { type: string; call_id?: string; id?: string; name?: string; arguments?: unknown } =>
      Boolean(item) && (item as { type?: string }).type === "function_call"
    )
    .map((item) => ({
      callId: item.call_id ?? item.id ?? "",
      name: item.name ?? "",
      argumentsText: typeof item.arguments === "string" ? item.arguments : ""
    }));
}

export function parseToolArguments(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export type VoiceClientHandlers = {
  onStatus?: (status: VoiceStatus) => void;
  onTranscript?: (entry: VoiceTranscript) => void;
  onAudio?: (base64: string) => void;
  onToolEvent?: (event: VoiceToolEvent) => void;
  onError?: (message: string) => void;
  onInterrupt?: () => void;
};

export function createVoiceClient(session: VoiceSessionPayload, handlers: VoiceClientHandlers = {}) {
  let socket: WebSocket | null = null;
  let closedByUs = false;
  let userTurn = "";
  let assistantTurn = "";
  const handled = new Set<string>();

  const setStatus = (status: VoiceStatus) => handlers.onStatus?.(status);
  const send = (payload: unknown) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  async function callTool(call: FunctionCall) {
    if (!call.callId || handled.has(call.callId)) return;
    handled.add(call.callId);
    const args = parseToolArguments(call.argumentsText);
    let result: unknown;
    try {
      const response = await fetch("/api/voice/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId: session.grantId, name: call.name, arguments: args })
      });
      result = await response.json();
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : "The tool call failed." };
    }
    handlers.onToolEvent?.({ name: call.name, arguments: args, result });
    send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: call.callId, output: JSON.stringify(result) }
    });
    send({ type: "response.create" });
  }

  function handleEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? "");
    switch (type) {
      case "session.created":
      case "session.updated":
        setStatus("live");
        break;
      case "input_audio_buffer.speech_started":
        handlers.onInterrupt?.();
        setStatus("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        setStatus("thinking");
        break;
      case "conversation.item.input_audio_transcription.delta":
        userTurn += String(event.delta ?? "");
        handlers.onTranscript?.({ role: "user", text: userTurn, final: false });
        break;
      case "conversation.item.input_audio_transcription.completed":
        userTurn = String(event.transcript ?? userTurn);
        handlers.onTranscript?.({ role: "user", text: userTurn, final: true });
        userTurn = "";
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
      case "response.output_text.delta":
        assistantTurn += String(event.delta ?? "");
        handlers.onTranscript?.({ role: "assistant", text: assistantTurn, final: false });
        break;
      case "response.output_audio.delta":
      case "response.audio.delta": {
        const chunk = String(event.delta ?? event.audio ?? "");
        if (chunk) handlers.onAudio?.(chunk);
        break;
      }
      case "response.function_call_arguments.done":
        void callTool({
          callId: String(event.call_id ?? ""),
          name: String(event.name ?? ""),
          argumentsText: String(event.arguments ?? "")
        });
        break;
      case "response.done": {
        const calls = functionCallsFromResponse(event);
        calls.forEach((call) => void callTool(call));
        if (assistantTurn.trim()) handlers.onTranscript?.({ role: "assistant", text: assistantTurn, final: true });
        assistantTurn = "";
        if (!calls.length) setStatus("live");
        break;
      }
      case "error":
        handlers.onError?.(String((event.error as { message?: string })?.message ?? "The model reported an error."));
        break;
      default:
        break;
    }
  }

  return {
    connect() {
      if (socket) return;
      closedByUs = false;
      setStatus("connecting");
      socket = new WebSocket(session.socketUrl, session.subprotocols);
      socket.onopen = () => {
        send(session.sessionUpdate);
        setStatus("live");
      };
      socket.onmessage = (message) => {
        let event: unknown;
        try {
          event = JSON.parse(typeof message.data === "string" ? message.data : "");
        } catch {
          return;
        }
        if (event && typeof event === "object" && "type" in event) handleEvent(event as Record<string, unknown>);
      };
      socket.onerror = () => {
        if (closedByUs) return;
        handlers.onError?.("The realtime connection failed. Check the API key and your network.");
      };
      socket.onclose = (event) => {
        socket = null;
        setStatus("idle");
        if (!closedByUs && event.code !== 1000) {
          handlers.onError?.(`The voice session closed${event.reason ? `: ${event.reason}` : " unexpectedly"}.`);
        }
      };
    },
    sendAudio(base64: string) {
      send({ type: "input_audio_buffer.append", audio: base64 });
    },
    sendText(text: string) {
      const value = text.trim();
      if (!value) return;
      send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: value }] } });
      send({ type: "response.create" });
      setStatus("thinking");
    },
    interrupt() {
      send({ type: "response.cancel" });
    },
    close() {
      closedByUs = true;
      if (socket) {
        try {
          socket.close(1000, "closed by user");
        } catch {
          /* already gone */
        }
        socket = null;
      }
      setStatus("idle");
    }
  };
}
