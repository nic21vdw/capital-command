import { config } from "dotenv";
import path from "node:path";
config({ path: path.join(process.cwd(), ".env"), quiet: true });
import { aiLadder, freeModels } from "@/lib/ai/provider";

const ZEN = "https://opencode.ai/zen/v1";
const PROMPT = 'Return ONLY minified JSON, no markdown fence: {"ok":true}';

type Probe = { ms: number; ok: boolean; note: string };

async function catalog(): Promise<string[] | null> {
  try {
    const response = await fetch(`${ZEN}/models`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const data = (await response.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((model) => model.id);
  } catch {
    return null;
  }
}

async function probe(base: string, model: string, key?: string): Promise<Probe> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: PROMPT }],
        max_tokens: 2000,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(120_000)
    });
    const ms = Date.now() - startedAt;
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ms, ok: false, note: `HTTP ${response.status} ${detail.slice(0, 120)}` };
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    const cleaned = (typeof raw === "string" ? raw : "").replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
    if (!cleaned) return { ms, ok: false, note: "answered nothing — spent the whole budget thinking" };
    try {
      if ((JSON.parse(cleaned) as { ok?: unknown }).ok === true) return { ms, ok: true, note: "clean JSON" };
    } catch {
      return { ms, ok: false, note: `not JSON: ${cleaned.slice(0, 70)}` };
    }
    return { ms, ok: false, note: `wrong JSON: ${cleaned.slice(0, 70)}` };
  } catch (error) {
    return { ms: Date.now() - startedAt, ok: false, note: String((error as Error)?.message ?? error) };
  }
}

async function main(): Promise<void> {
  const ids = await catalog();
  console.log(
    ids
      ? `zen catalog: ${ids.length} models, ${ids.filter((id) => id.endsWith("-free")).length} of them free`
      : "zen catalog: unreachable"
  );
  console.log("");

  let firstLive: string | null = null;
  for (const model of freeModels()) {
    const result = await probe(ZEN, model);
    if (result.ok && !firstLive) firstLive = model;
    const listed = ids && !ids.includes(model) ? "  [NOT IN CATALOG]" : "";
    console.log(
      `${result.ok ? "OK  " : "DEAD"}  ${model.padEnd(34)} ${String(result.ms).padStart(6)}ms  ${result.note}${listed}`
    );
  }

  console.log("");
  const paid = aiLadder().find((step) => !step.free);
  if (paid) {
    const result = await probe(paid.base, paid.model, paid.key);
    console.log(`${result.ok ? "OK  " : "DEAD"}  paid ${paid.model} @ ${paid.base}  ${result.ms}ms  ${result.note}`);
  } else {
    console.log("no paid fallback configured — the free tier is all there is");
  }

  console.log("");
  if (firstLive) {
    console.log(`Content creation is free: ${firstLive} answers, and it is what the app will use.`);
  } else {
    console.log("EVERY FREE MODEL IS DEAD.");
    console.log("Pick free ids that still answer from the catalog above and set AI_FREE_MODELS in .env.");
    process.exitCode = 1;
  }
}

void main();
