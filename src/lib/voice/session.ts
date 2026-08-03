import { REALTIME_SAMPLE_RATE } from "@/lib/voice/pcm";
import { buildSubprotocols, getVoiceProvider, realtimeSocketUrl, voiceApiKey, voiceModel } from "@/lib/voice/providers";
import type { VoiceProvider } from "@/lib/voice/providers";
import { voiceToolDefinitions } from "@/lib/voice/tools";

export type VoiceGrant = {
  id: string;
  allowActions: boolean;
  expiresAt: number;
};

type GrantStore = Map<string, VoiceGrant>;

const GRANT_TTL_MS = 60 * 60 * 1000;

function grants(): GrantStore {
  const holder = globalThis as typeof globalThis & { __capitalCommandVoiceGrants?: GrantStore };
  if (!holder.__capitalCommandVoiceGrants) holder.__capitalCommandVoiceGrants = new Map();
  return holder.__capitalCommandVoiceGrants;
}

export function issueGrant(allowActions: boolean): VoiceGrant {
  const store = grants();
  const now = Date.now();
  for (const [id, grant] of store) if (grant.expiresAt <= now) store.delete(id);
  const grant: VoiceGrant = { id: `voice-grant-${crypto.randomUUID()}`, allowActions, expiresAt: now + GRANT_TTL_MS };
  store.set(grant.id, grant);
  return grant;
}

export function readGrant(id: string | undefined): VoiceGrant | null {
  if (!id) return null;
  const grant = grants().get(id);
  if (!grant) return null;
  if (grant.expiresAt <= Date.now()) {
    grants().delete(id);
    return null;
  }
  return grant;
}

export function revokeGrant(id: string | undefined): void {
  if (id) grants().delete(id);
}

export function buildSessionUpdate(input: {
  provider: VoiceProvider;
  instructions: string;
  voice: string;
  allowActions: boolean;
}) {
  const pcm = { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE };
  const session: Record<string, unknown> = {
    instructions: input.instructions,
    tools: voiceToolDefinitions(input.allowActions),
    tool_choice: "auto"
  };
  if (input.provider.sessionType) {
    session.type = input.provider.sessionType;
    session.audio = {
      input: {
        format: pcm,
        turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
        transcription: { model: "whisper-1" }
      },
      output: { format: pcm, voice: input.voice }
    };
  } else {
    session.voice = input.voice;
    session.turn_detection = { type: "server_vad", threshold: 0.5, silence_duration_ms: 700, prefix_padding_ms: 300 };
    session.audio = { input: { format: pcm, transcription: {} }, output: { format: pcm } };
  }
  return { type: "session.update", session };
}

export function readMintedSecret(payload: unknown): string {
  const data = payload as {
    value?: unknown;
    secret?: unknown;
    token?: unknown;
    client_secret?: unknown;
  } | null;
  const nested = data?.client_secret as { value?: unknown } | string | undefined;
  const candidate =
    data?.value ??
    (typeof nested === "string" ? nested : nested?.value) ??
    data?.secret ??
    data?.token;
  if (typeof candidate !== "string" || !candidate) throw new Error("The realtime provider returned no client secret.");
  return candidate;
}

export function explainMintFailure(status: number, detail: string, provider: VoiceProvider): string {
  let message = detail;
  try {
    const parsed = JSON.parse(detail) as { error?: unknown; message?: unknown };
    const inner = parsed.error ?? parsed.message;
    message = typeof inner === "string" ? inner : JSON.stringify(inner ?? detail);
  } catch {
    message = detail;
  }
  if (/run out of credits|spending[- ]limit|need a Grok subscription/i.test(message)) {
    return `${provider.label} has no allowance left on this account. Top up the ${provider.id === "xai" ? "xAI" : "OpenAI"} account and try again.`;
  }
  if (status === 401) return `${provider.label} rejected ${provider.keyEnv}. Check the key in .env.`;
  if (status === 429) return `${provider.label} is rate limited right now. Wait a moment and start the session again.`;
  return `Could not start ${provider.label} (HTTP ${status}). ${message.slice(0, 200)}`;
}

export async function mintVoiceSecret(providerId: string, model: string): Promise<string> {
  const provider = getVoiceProvider(providerId);
  const key = voiceApiKey(provider);
  if (!key) throw new Error(`${provider.label} is not configured. Add ${provider.keyEnv} to .env.`);
  const body =
    provider.id === "openai"
      ? { session: { type: "realtime", model } }
      : { expires_after: { seconds: 600 } };
  const response = await fetch(provider.mintEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(explainMintFailure(response.status, (await response.text().catch(() => "")).slice(0, 500), provider));
  }
  return readMintedSecret(await response.json());
}

export async function createVoiceSession(input: {
  providerId: string;
  voice?: string;
  instructions: string;
  allowActions: boolean;
}) {
  const provider = getVoiceProvider(input.providerId);
  const model = voiceModel(provider);
  const voice = provider.voices.includes(input.voice ?? "") ? (input.voice as string) : provider.defaultVoice;
  const secret = await mintVoiceSecret(provider.id, model);
  const grant = issueGrant(input.allowActions);
  return {
    grantId: grant.id,
    provider: provider.id,
    label: provider.label,
    model,
    voice,
    socketUrl: realtimeSocketUrl(provider, model),
    subprotocols: buildSubprotocols(provider, secret),
    sessionUpdate: buildSessionUpdate({ provider, instructions: input.instructions, voice, allowActions: input.allowActions })
  };
}
