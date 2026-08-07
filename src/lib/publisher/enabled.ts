import { readFile, writeFile } from "node:fs/promises";
import { applyEnvValue, envFilePath } from "@/lib/podcast/publicUrl";
import { publisherConfig } from "@/lib/publisher/config";

// Whether the app may post at all. It has always lived in `.env`, which meant
// every surface that hit it printed "set PUBLISH_ENABLED=true in .env" — a file
// path and a restart, in the middle of a screen. It is a plain on/off, not a
// secret, so it can be set from Settings the same way the podcast's public
// address is, using the same careful rewrite (BOM, CRLF, comments and `export`
// prefixes preserved) and `process.env` so nothing has to be restarted.

const KEY = "PUBLISH_ENABLED";

export function publishingEnabled(): boolean {
  return publisherConfig().enabled;
}

export async function setPublishingEnabled(enabled: boolean): Promise<void> {
  const file = envFilePath();
  const current = await readFile(file, "utf8").catch(() => "");
  await writeFile(file, applyEnvValue(current, KEY, enabled ? "true" : "false"), "utf8");
  process.env[KEY] = enabled ? "true" : "false";
}

/** What is in the way of an unattended run booking anything, in his words. */
export function bookingBlockers(): string[] {
  const config = publisherConfig();
  const blockers: string[] = [];
  if (!config.enabled) blockers.push("Publishing is switched off, so nothing can be scheduled.");
  else if (config.platforms.length === 0) blockers.push("No platforms are switched on, so nothing has anywhere to go.");
  return blockers;
}
