import { describeXaiAuth } from "@/lib/voice/xaiAuth";

export type VoiceProviderId = "openai" | "xai";

export type VoiceProvider = {
  id: VoiceProviderId;
  label: string;
  socketUrl: string;
  mintEndpoint: string;
  subprotocolPrefix: string;
  extraSubprotocols: string[];
  sessionType: string;
  keyEnv: string;
  modelEnv: string;
  defaultModel: string;
  voices: string[];
  defaultVoice: string;
};

export const VOICE_PROVIDERS: Record<VoiceProviderId, VoiceProvider> = {
  openai: {
    id: "openai",
    label: "ChatGPT Realtime",
    socketUrl: "wss://api.openai.com/v1/realtime",
    mintEndpoint: "https://api.openai.com/v1/realtime/client_secrets",
    subprotocolPrefix: "openai-insecure-api-key.",
    extraSubprotocols: ["realtime"],
    sessionType: "realtime",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_REALTIME_MODEL",
    defaultModel: "gpt-realtime-2.1",
    voices: ["alloy", "ash", "ballad", "cedar", "coral", "echo", "marin", "sage", "shimmer", "verse"],
    defaultVoice: "cedar"
  },
  xai: {
    id: "xai",
    label: "Grok Voice",
    socketUrl: "wss://api.x.ai/v1/realtime",
    mintEndpoint: "https://api.x.ai/v1/realtime/client_secrets",
    subprotocolPrefix: "xai-client-secret.",
    extraSubprotocols: [],
    sessionType: "",
    keyEnv: "XAI_API_KEY",
    modelEnv: "XAI_REALTIME_MODEL",
    defaultModel: "grok-voice-latest",
    voices: ["eve", "ara", "rex", "sal", "leo"],
    defaultVoice: "eve"
  }
};

export const DEFAULT_VOICE_PROVIDER: VoiceProviderId = "openai";

export function getVoiceProvider(id: string | undefined): VoiceProvider {
  return VOICE_PROVIDERS[(id as VoiceProviderId) in VOICE_PROVIDERS ? (id as VoiceProviderId) : DEFAULT_VOICE_PROVIDER];
}

export function voiceModel(provider: VoiceProvider): string {
  return process.env[provider.modelEnv]?.trim() || provider.defaultModel;
}

export function voiceApiKey(provider: VoiceProvider): string | undefined {
  return process.env[provider.keyEnv]?.trim() || undefined;
}

export function realtimeSocketUrl(provider: VoiceProvider, model: string): string {
  return `${provider.socketUrl}?model=${encodeURIComponent(model)}`;
}

export function buildSubprotocols(provider: VoiceProvider, secret: string): string[] {
  const value = secret.trim();
  if (!value) return [];
  return [...provider.extraSubprotocols, provider.subprotocolPrefix + value];
}

export async function voiceProviderStatus() {
  const subscription = await describeXaiAuth();
  return (Object.keys(VOICE_PROVIDERS) as VoiceProviderId[]).map((id) => {
    const provider = VOICE_PROVIDERS[id];
    const hasKey = Boolean(voiceApiKey(provider));
    const onSubscription = id === "xai" && subscription.signedIn;
    return {
      id,
      label: provider.label,
      model: voiceModel(provider),
      voices: provider.voices,
      defaultVoice: provider.defaultVoice,
      configured: onSubscription || hasKey,
      billing: onSubscription ? ("subscription" as const) : hasKey ? ("api-key" as const) : ("none" as const),
      subscription: id === "xai" ? subscription : null
    };
  });
}
