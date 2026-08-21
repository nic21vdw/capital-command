/**
 * The single AI gateway for Capital Command. Every feature that talks to a
 * language model — clip moment selection, viral titles, upload metadata, idea
 * research, scripts, carousels, X posts, competitor insights, longform
 * metadata and the calendar planner — routes through `runAi` here instead of
 * newing up a provider SDK itself.
 *
 * Default: the FREE, KEYLESS models on opencode.ai/zen, so every AI feature
 * works out of the box for $0.
 *
 * There is no single free model any more, and pinning one is what broke this.
 * `deepseek-v4-flash-free` was hardcoded here until opencode retired it
 * upstream: the catalog still lists the id, but every call answers HTTP 400
 * "Model is unavailable", a non-OK response became null, and every caller
 * silently dropped to its offline heuristic. Nothing looked broken — the
 * carousels just got worse. So the free tier is a LADDER, not a name: the
 * first model that answers wins, a model that is retired or spent is struck
 * off for the life of the process, and opencode can drop another one without
 * taking the app with it.
 *
 * Tiers (env AI_TIER):
 *   "auto" (default) → free ladder, then the paid endpoint when a key is set
 *   "free"           → free ladder only, never spends money
 *   "paid"           → paid endpoint only (needs DEEPSEEK_API_KEY)
 *
 * Provider resolution (env AI_PROVIDER):
 *   "deepseek" (default) → the tiers above
 *   "anthropic"/"claude" → Claude (needs ANTHROPIC_API_KEY)
 *   "auto"               → Claude when ANTHROPIC_API_KEY is set, else DeepSeek
 *
 * Several of these are REASONING models: they think in `reasoning_content` and
 * answer in `content`, both paid for out of the same max_tokens budget, so a
 * big request needs room for the thinking as well as the answer (see
 * runEndpoint).
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
export type AiTier = "auto" | "free" | "paid";

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const DEFAULT_PAID_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_PAID_MODEL = "deepseek-chat";
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";

/**
 * The free, keyless models on opencode.ai/zen, best first. Ordered by how fast
 * each returns PARSEABLE JSON on the app's own workload, because a model that
 * wraps its answer in prose costs a whole retry ladder.
 *
 * Two live free models are deliberately absent. `hy3-free` spent its budget
 * thinking and returned nothing, and `nemotron-3.5-lightning-free` writes its
 * thinking into `content` — it would hand a caller "Here's a thinking process:"
 * as if that were the post.
 *
 * AI_FREE_MODELS overrides the whole list (comma-separated) for when opencode's
 * catalog moves again and the app has not been updated yet.
 */
const FREE_MODELS = [
  "laguna-s-2.1-free",
  "muse-spark-1.2-contributor-free",
  "mimo-v2.5-free",
  "nemotron-3-ultra-free",
  "x-preview-f-free"
] as const;

/**
 * Free-tier output-token budget. The free models cost nothing, so this floor is
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

/** How long the whole escalation ladder may run before a call stops retrying. */
const RETRY_DEADLINE_MS = 150_000;

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * Models that answered "not here" this process — retired upstream, or a free
 * allowance that is spent. Skipped for the life of the server so one dead name
 * costs one request, not one per call. A restart re-tests them.
 */
const struckOff = new Set<string>();

/** Clears the struck-off memo. For tests and the health check. */
export function resetAiModelHealth(): void {
  struckOff.clear();
}

/** The free ladder, minus anything struck off this process. */
export function freeModels(): string[] {
  const configured = env("AI_FREE_MODELS");
  const all = configured ? configured.split(",").map((name) => name.trim()).filter(Boolean) : [...FREE_MODELS];
  const live = all.filter((name) => !struckOff.has(name));
  // Everything struck off means the memo is stale, not that the tier is gone.
  return live.length ? live : all;
}

/** Which tier a DeepSeek-side call will use. */
export function resolveTier(): AiTier {
  const raw = (env("AI_TIER") || "").toLowerCase();
  if (raw === "free") return "free";
  if (raw === "paid") return "paid";
  return "auto";
}

function paidKey(): string | undefined {
  return env("DEEPSEEK_API_KEY") || env("OPENCODE_API_KEY");
}

/**
 * The paid endpoint, when one is configured. DEEPSEEK_* point at DeepSeek's own
 * API by default; an OPENCODE_API_KEY on its own means a paid zen plan, which is
 * the same base URL as the free tier with a Bearer token and the unsuffixed
 * model names.
 */
function paidEndpoint(): { base: string; model: string; key: string } | null {
  const key = paidKey();
  if (!key) return null;
  const zenOnly = !env("DEEPSEEK_API_KEY") && !env("DEEPSEEK_BASE_URL");
  const base = env("DEEPSEEK_BASE_URL") || (zenOnly ? ZEN_BASE_URL : DEFAULT_PAID_BASE_URL);
  const model = env("DEEPSEEK_MODEL") || (zenOnly ? "deepseek-v4-flash" : DEFAULT_PAID_MODEL);
  return { base: base.replace(/\/+$/, ""), model, key };
}

/** Which provider a call will use, given AI_PROVIDER and the available keys. */
export function resolveProvider(): AiProvider {
  const raw = (env("AI_PROVIDER") || "").toLowerCase();
  if (raw === "anthropic" || raw === "claude") return "anthropic";
  if (raw === "deepseek" || raw === "flash" || raw === "free") return "deepseek";
  if (raw === "auto") return env("ANTHROPIC_API_KEY") ? "anthropic" : "deepseek";
  // Default: the free zen ladder — free and keyless.
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

type Endpoint = { base: string; model: string; key?: string; free: boolean };

/** The endpoints a DeepSeek-side call will try, in order. */
export function aiLadder(): Endpoint[] {
  const tier = resolveTier();
  const free: Endpoint[] = freeModels().map((model) => ({ base: ZEN_BASE_URL, model, free: true }));
  const paid = paidEndpoint();
  if (tier === "free") return free;
  if (tier === "paid") return paid ? [{ ...paid, free: false }] : [];
  return paid ? [...free, { ...paid, free: false }] : free;
}

/** Human-readable summary of the active provider (for diagnostics / UI). */
export function aiProviderInfo(): { provider: AiProvider; model: string; free: boolean } {
  const provider = resolveProvider();
  if (provider === "anthropic") {
    return { provider, model: env("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL, free: false };
  }
  const first = aiLadder()[0];
  if (!first) return { provider, model: env("DEEPSEEK_MODEL") || DEFAULT_PAID_MODEL, free: false };
  return { provider, model: first.model, free: first.free };
}

/**
 * True when at least one provider can serve a request. The free ladder is
 * keyless, so this is true by default — every AI feature is "configured" out of
 * the box. Only the explicit Anthropic-only and paid-only modes need a key.
 */
export function aiConfigured(): boolean {
  if (resolveProvider() === "anthropic") return Boolean(env("ANTHROPIC_API_KEY"));
  if (resolveTier() === "paid") return Boolean(paidKey());
  return true;
}

type Attempt = {
  /** The model's answer. Empty when it never got as far as writing one. */
  text: string;
  refused: boolean;
  /**
   * True when the budget was spent thinking before the answer began. That is
   * not a failure — the same call succeeds with more room.
   */
  outOfRoom: boolean;
};

/**
 * A transport or HTTP failure. `gone` marks the model itself as the problem —
 * retired upstream, or a free allowance that is spent — which is worth striking
 * off rather than retrying.
 */
type Failure = { failed: true; gone: boolean };

function isFailure(value: Attempt | AiResult | Failure | null): value is Failure {
  return Boolean(value) && (value as Failure).failed === true;
}

/** One chat-completions call against one endpoint at one specific token budget. */
async function callChat(endpoint: Endpoint, req: AiRequest, maxTokens: number): Promise<Attempt | Failure> {
  const messages: Array<{ role: string; content: string }> = [];
  if (req.system?.trim()) messages.push({ role: "system", content: req.system });
  for (const message of req.messages) messages.push({ role: message.role, content: message.content });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs(maxTokens));
  try {
    const response = await fetch(`${endpoint.base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(endpoint.key ? { Authorization: `Bearer ${endpoint.key}` } : {})
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages,
        temperature: req.temperature ?? 0.2,
        max_tokens: maxTokens
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      // A non-OK response used to vanish here, which is why a spent free quota
      // looked like bad prompts for a week. Say what happened, every time.
      const detail = await response.text().catch(() => "");
      const gone = response.status === 404 || response.status === 429 || /model is unavailable/i.test(detail);
      console.warn(
        `[ai] ${endpoint.model} answered HTTP ${response.status}${gone ? " — striking it off" : ""}: ${detail.slice(0, 200)}`
      );
      return { failed: true, gone };
    }
    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
        finish_reason?: string;
      }>;
    };
    const choice = data?.choices?.[0];
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    // Zen models are not consistent about which field the scratchpad lands in.
    const scratchpad = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
    const reasoning = typeof scratchpad === "string" ? scratchpad : "";
    const refused = choice?.finish_reason === "content_filter";

    // Several of these are REASONING models: they think in `reasoning_content`
    // and answer in `content`, and both come out of the same max_tokens budget.
    // Reading only `content` — and treating an empty one as a dead provider —
    // is why every AI feature in the app quietly fell back to its offline
    // heuristic on any answer big enough that the thinking ran to the end of
    // the budget.
    const outOfRoom = !text.trim() && (choice?.finish_reason === "length" || Boolean(reasoning.trim()));
    return { text, refused, outOfRoom };
  } catch {
    return { failed: true, gone: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One endpoint, with room to think. Starts at the caller's budget and doubles up
 * to the hard ceiling whenever the model used everything up reasoning without
 * answering, so a big request (a 24-post pack, a long script) gets what it needs
 * instead of silently degrading. The scratchpad is never returned as the answer.
 *
 * Returns a Failure only when the endpoint itself could not be reached, which is
 * what makes moving to the next model in the ladder the right response. A model
 * that answered — even emptily, even with a refusal — has had its say, and
 * asking the next one would just spend another minute to be told the same.
 */
async function runEndpoint(endpoint: Endpoint, req: AiRequest): Promise<AiResult | null | Failure> {
  let budget = aiMaxTokens(req.maxTokens);
  const startedAt = Date.now();

  for (;;) {
    const attempt = await callChat(endpoint, req, budget);
    if (isFailure(attempt)) return attempt;
    if (attempt.text.trim()) return { text: attempt.text, refused: attempt.refused };
    // A refusal is a real answer: the caller decides what to do about it.
    if (attempt.refused) return { text: "", refused: true };
    if (!attempt.outOfRoom || budget >= HARD_MAX_TOKENS) return null;
    // Each escalation also doubles the timeout, so an unbounded ladder could sit
    // on one stage for eight minutes before giving up. Stop starting new
    // attempts once the call has already had a fair share of the wall clock —
    // the caller's offline fallback beats another four-minute wait.
    if (Date.now() - startedAt > RETRY_DEADLINE_MS) {
      console.warn(
        `[ai] ${endpoint.model} spent ${Math.round((Date.now() - startedAt) / 1000)}s without answering — giving up.`
      );
      return null;
    }

    const raised = Math.min(HARD_MAX_TOKENS, budget * 2);
    if (raised <= budget) return null;
    console.warn(
      `[ai] ${endpoint.model} used its whole ${budget}-token budget thinking without answering — retrying with ${raised}.`
    );
    budget = raised;
  }
}

/**
 * Walks the tier ladder until something answers. A model that is gone is struck
 * off on the way past, so the next call starts at the one that works.
 */
async function runLadder(req: AiRequest): Promise<AiResult | null> {
  const endpoints = aiLadder();
  for (const endpoint of endpoints) {
    const result = await runEndpoint(endpoint, req);
    if (isFailure(result)) {
      if (endpoint.free && result.gone) struckOff.add(endpoint.model);
      continue;
    }
    return result;
  }
  if (endpoints.length) console.warn("[ai] every configured model failed to answer.");
  return null;
}

async function runAnthropic(req: AiRequest): Promise<AiResult | null> {
  const model = env("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL;
  // Imported dynamically so the Anthropic SDK (server-only; pulls in node:*)
  // never lands in the client bundle when this module is reached from a shared
  // module. The default free path uses fetch and needs nothing here.
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
    // Only attempt Anthropic when a key exists; the free ladder is always usable.
    if (provider === "anthropic" && !env("ANTHROPIC_API_KEY")) continue;
    try {
      const result = provider === "anthropic" ? await runAnthropic(req) : await runLadder(req);
      if (result) return result;
    } catch {
      // Try the next provider in the order, if any.
    }
  }
  return null;
}
