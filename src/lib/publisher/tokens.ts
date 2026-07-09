import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { publisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";
import { getDataRoot } from "@/lib/storage/data-root";

/**
 * Tiny persisted key/value cache for OAuth tokens that rotate server-side
 * (TikTok can return a NEW refresh token on every refresh; losing it would
 * strand the integration until the user re-authorizes). Values live next to
 * the queue: a local JSON file by default, or an object in the R2 bucket when
 * the queue backend is r2 so GitHub Actions runs share the same rotation.
 *
 * .env values act as the initial seed; a cached value always wins after that.
 */

const tokensFilePath = () => path.join(getDataRoot(), "publisher-tokens.json");
const R2_KEY = "publisher/tokens.json";

async function readAll(): Promise<Record<string, string>> {
  const config = publisherConfig();
  try {
    if (config.queueBackend === "r2") {
      const host = mediaHost(config);
      const text = host ? await host.getObjectText(R2_KEY) : null;
      return text ? (JSON.parse(text) as Record<string, string>) : {};
    }
    return JSON.parse(await readFile(tokensFilePath(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeAll(values: Record<string, string>): Promise<void> {
  const config = publisherConfig();
  const text = JSON.stringify(values, null, 2);
  if (config.queueBackend === "r2") {
    const host = mediaHost(config);
    if (host) {
      await host.putObjectText(R2_KEY, text);
      return;
    }
  }
  const filePath = tokensFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

export async function getCachedToken(key: string): Promise<string | null> {
  return (await readAll())[key] ?? null;
}

export async function setCachedToken(key: string, value: string): Promise<void> {
  const values = await readAll();
  if (values[key] === value) return;
  values[key] = value;
  await writeAll(values);
}
