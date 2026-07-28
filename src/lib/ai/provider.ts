/**
 * The single AI gateway for Capital Command. Every feature that talks to a
 * language model — clip moment selection, viral titles, upload metadata, idea
 * research, scripts, carousels, X posts, competitor insights, longform
 * metadata and the calendar planner — routes through `runAi` here instead of
 * newing up a provider SDK itself.
 *
 * Default provider: DeepSeek Flash (free) via an OpenAI-compatible endpoint —
 * no API key required, so every AI feature works out of the box for $0. It is
 * a REASONING model: it thinks in `reasoning_content` and answers in
 * `content`, both paid for out of the same max_tokens budget, so a big request
 * needs room for the thinking as well as the answer (see runDeepSeek).
 * Anthropic (Claude) stays available and can be selected with AI_PROVIDER when
 * a key is present, so nothing that relied on Claude breaks.
 *
 * Provider resolution (env AI_PROVIDER):
 *   "deepseek" (default) → DeepSeek Flash, free, keyless
 *   "anthropic"/"claude" → Claude (needs ANTHROPIC_API_KEY)
 *   "auto"               → Claude when ANTHROPIC_API_KEY is set, else DeepSeek
 *
 * `runAi` never throws: on any failure it returns null (or falls through to the
 * other provider when that one is configured), so every caller keeps its own
 * offline heuristic as the last-resort fallback and the app never hard-fails on
 * a flaky free endpoint.
 */

export type AiRole = "user" | "assistant";
export type AiMessage = { role: AiRole; content: string };

export type AiRequest = {
  /** System prompt / role instruction. */
  system?: string;
  /** Conversation turns (usually a single user message). */
  messages: AiMessage[];
  /** Output-token ceiling for this call; defaults to the free budget. */
  maxTokens?: number;
  /** Sampling temperature; defaults to 0.2 for stable JSON. */
  temperature?: number;
};

export type AiResult = {
  /** The model's text reply (concatenated text blocks). */
  text: string;
  /** True when the model refused / the reply was content-filtered. */
  refused: boolean;
};

export type AiProvider = "deepseek" | "anthropic";

const DEFAULT_DEEPSEEK_BASE_URL = "https://opencode.ai/zen/v1";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash-free";
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";

/**
 * Free-tier output-token budget. DeepSeek Flash is free, so this floor is
 * deliberately generous — every AI call gets at least this much room, and
 * AI_MAX_TOKENS raises (or lowers) it globally. A caller that asks for more
 * (e.g. long script generation) still gets what it asked for, up to the hard
 * ceiling that keeps a runaway request from being rejected by the endpoint.
 */
const DEFAULT_MAX_TOKENS = 8000;
const HARD_MAX_TOKENS = 32000;

/**
 * A slow free endpoint must never stall the clip pipeline or publish queue,
 * but a reasoning model asked for a big answer genuinely takes minutes — it
 * thinks before it writes. The allowance scales with the token budget (roughly
 * 10ms per output token) between a one-minute floor and a four-minute ceiling.
 */
function requestTimeoutMs(maxTokens: number): number {
  return Math.min(240_000, Math.max(60_000, maxTokens * 10));
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/** Which provider a call will use, given AI_PROVIDER and the available keys. */
export function resolveProvider(): AiProvider {
  const raw = (env("AI_PROVIDER") || "").toLowerCase();
  if (raw === "anthropic" || raw === "claude") return "anthropic";
  if (raw === "deepseek" || raw === "flash") return "deepseek";
  if (raw === "auto") return env("ANTHROPIC_API_KEY") ? "anthropic" : "deepseek";
  // Default: DeepSeek Flash everywhere — free and keyless.
  return "deepseek";
}

/**
 * Effective output-token ceiling for a call: at least the free budget
 * (AI_MAX_TOKENS or DEFAULT_MAX_TOKENS), more when the caller asked for more,
 * capped so no request is rejected for exceeding the endpoint's limit.
 */
export function aiMaxTokens(requested?: number): number {
  const envMax = Number(env("AI_MAX_TOKENS"));
  const budget = Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_TOKENS;
  const want = requested && Number.isFinite(requested) && requested > 0 ? requested : 0;
  return Math.min(HARD_MAX_TOKENS, Math.max(budget, want));
}

/** Human-readable summary of the active provider (for diagnostics / UI). */
export function aiProviderInfo(): { provider: AiProvider; model: string; free: boolean } {
  const provider = resolveProvider();
  if (provider === "anthropic") {
    return { provider, model: env("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL, free: false };
  }
  return { provider, model: env("DEEPSEEK_MODEL") || DEFAULT_DEEPSEEK_MODEL, free: true };
}

/**
 * True when at least one provider can serve a request. DeepSeek Flash is
 * keyless, so this is true by default — every AI feature is "configured" out of
 * the box. Only the explicit Anthropic-only mode needs a key.
 */
export function aiConfigured(): boolean {
  if (resolveProvider() === "anthropic") return Boolean(env("ANTHROPIC_API_KEY"));
  return true;
}

type DeepSeekAttempt = {
  /** The model's answer. Empty when it never got as far as writing one. */
  text: string;
  refused: boolean;
  /**
   * True when the budget was spent thinking before the answer began. That is
   * not a failure — the same call succeeds with more room.
   */
  outOfRoom: boolean;
};

/** One DeepSeek call at one specific token budget. Null on a transport/HTTP failure. */
async function callDeepSeek(req: AiRequest, maxTokens: number): Promise<DeepSeekAttempt | null> {
  const base = (env("DEEPSEEK_BASE_URL") || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/, "");
  const model = env("DEEPSEEK_MODEL") || DEFAULT_DEEPSEEK_MODEL;
  // Optional — the free tier is keyless, but a key is sent as a Bearer token
  // when provided (e.g. a paid opencode.ai/zen plan).
  const key = env("DEEPSEEK_API_KEY") || env("OPENCODE_API_KEY");

  const messages: Array<{ role: string; content: string }> = [];
  if (req.system?.trim()) messages.push({ role: "system", content: req.system });
  for (const message of req.messages) messages.push({ role: message.role, content: message.content });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs(maxTokens));
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: req.temperature ?? 0.2,
        max_tokens: maxTokens
      }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: unknown; reasoning_content?: unknown };
        finish_reason?: string;
      }>;
    };
    const choice = data?.choices?.[0];
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    const reasoning =
      typeof choice?.message?.reasoning_content === "string" ? choice.message.reasoning_content : "";
    const refused = choice?.finish_reason === "content_filter";

    // DeepSeek's flash models are REASONING models: they think in
    // `reasoning_content` and answer in `content`, and both come out of the
    // same max_tokens budget. Reading only `content` — and treating an empty
    // one as a dead provider — is why every AI feature in the app quietly fell
    // back to its offline heuristic on any answer big enough that the thinking
    // ran to the end of the budget.
    const outOfRoom = !text.trim() && (choice?.finish_reason === "length" || Boolean(reasoning.trim()));
    return { text, refused, outOfRoom };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * DeepSeek with room to think. Starts at the caller's budget and doubles up to
 * the hard ceiling whenever the model used everything up reasoning without
 * answering, so a big request (a 24-post pack, a long script) gets what it
 * needs instead of silently degrading. `reasoning_content` is never returned as
 * the answer — it is the model's scratchpad, not its output.
 */
async function runDeepSeek(req: AiRequest): Promise<AiResult | null> {
  let budget = aiMaxTokens(req.maxTokens);

  for (;;) {
    const attempt = await callDeepSeek(req, budget);
    if (!attempt) return null;
    if (attempt.text.trim()) return { text: attempt.text, refused: attempt.refused };
    // A refusal is a real answer: the caller decides what to do about it.
    if (attempt.refused) return { text: "", refused: true };
    if (!attempt.outOfRoom || budget >= HARD_MAX_TOKENS) return null;

    const raised = Math.min(HARD_MAX_TOKENS, budget * 2);
    if (raised <= budget) return null;
    console.warn(
      `[ai] deepseek used its whole ${budget}-token budget thinking without answering — retrying with ${raised}.`
    );
    budget = raised;
  }
}

async function runAnthropic(req: AiRequest): Promise<AiResult | null> {
  const model = env("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL;
  // Imported dynamically so the Anthropic SDK (server-only; pulls in node:*)
  // never lands in the client bundle when this module is reached from a shared
  // module. The default DeepSeek path uses fetch and needs nothing here.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: aiMaxTokens(req.maxTokens),
    ...(req.system?.trim() ? { system: req.system } : {}),
    messages: req.messages.map((message) => ({ role: message.role, content: message.content }))
  });
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("\n");
  return { text, refused: response.stop_reason === "refusal" };
}

/**
 * Runs one model call through the active provider. Tries the resolved provider
 * first; if it throws or returns nothing and the OTHER provider is configured,
 * falls back to it. Returns null when no provider could produce a reply, so the
 * caller can use its own offline heuristic.
 */
export async function runAi(req: AiRequest): Promise<AiResult | null> {
  const primary = resolveProvider();
  const order: AiProvider[] = primary === "anthropic" ? ["anthropic", "deepseek"] : ["deepseek", "anthropic"];
  for (const provider of order) {
    // Only attempt Anthropic when a key exists; DeepSeek Flash is always usable.
    if (provider === "anthropic" && !env("ANTHROPIC_API_KEY")) continue;
    try {
      const result = provider === "anthropic" ? await runAnthropic(req) : await runDeepSeek(req);
      if (result) return result;
    } catch {
      // Try the next provider in the order, if any.
    }
  }
  return null;
}
