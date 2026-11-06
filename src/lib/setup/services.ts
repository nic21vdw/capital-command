import type { ConnectionField } from "@/lib/publisher/connections";

export type SetupService = {
  id: string;
  label: string;
  purpose: string;
  fields: ConnectionField[];
  console?: string;
  notes?: string[];
};

export const SERVICES: SetupService[] = [
  {
    id: "ai-writing",
    label: "AI writing",
    purpose: "Writes titles, captions, carousels, scripts, ideas and Threads posts.",
    fields: [
      {
        name: "DEEPSEEK_API_KEY",
        label: "DeepSeek API key",
        optional: true,
        hint: "Optional. A free model writes without a key; a key adds a paid model for when the free one is busy."
      }
    ],
    console: "https://platform.deepseek.com/api_keys"
  },
  {
    id: "openai",
    label: "OpenAI",
    purpose: "The ChatGPT brain for Sourceflow Agents, and ChatGPT Realtime live voice.",
    fields: [{ name: "OPENAI_API_KEY", label: "API key", hint: "OpenAI platform, API keys. Billed per use by OpenAI." }],
    console: "https://platform.openai.com/api-keys"
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    purpose: "The Grok brain for Sourceflow Agents.",
    fields: [{ name: "XAI_API_KEY", label: "API key", hint: "xAI console, API keys." }],
    console: "https://console.x.ai"
  },
  {
    id: "fal",
    label: "fal.ai",
    purpose: "Music Studio, and the optional picture check on carousels and best-of edits.",
    fields: [{ name: "FAL_KEY", label: "API key", hint: "fal.ai dashboard, Keys. Generations are billed per use by fal." }],
    console: "https://fal.ai/dashboard/keys"
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    purpose: "Voiceover in your own cloned voice.",
    fields: [
      { name: "ELEVENLABS_API_KEY", label: "API key", hint: "ElevenLabs, Developers, API keys." },
      { name: "ELEVENLABS_VOICE_ID", label: "Voice ID", hint: "ElevenLabs, Voices: the ID of the voice to speak with." }
    ],
    console: "https://elevenlabs.io/app/settings/api-keys"
  },
  {
    id: "product-hunt",
    label: "Product Hunt",
    purpose: "Reads a launch's live votes and rank on Launch Pad.",
    fields: [{ name: "PRODUCT_HUNT_TOKEN", label: "Developer token", hint: "Product Hunt API dashboard, your app's developer token." }],
    console: "https://www.producthunt.com/v2/oauth/applications"
  }
];

export const SERVICE_FIELD_NAMES: string[] = SERVICES.flatMap((service) => service.fields.map((field) => field.name));

export function serviceReady(service: SetupService, present: Record<string, boolean>): boolean {
  const required = service.fields.filter((field) => !field.optional);
  return required.every((field) => present[field.name]);
}

export function serviceSetupHref(id: string): string {
  return `/settings?service=${encodeURIComponent(id)}#services`;
}

export function accountSetupHref(id?: string): string {
  return id ? `/settings?connect=${encodeURIComponent(id)}#accounts` : "/settings#accounts";
}
