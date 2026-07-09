import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getDataRoot } from "@/lib/storage/data-root";

// Append-only title log. Every generated title — long-form or short-form —
// gets one line here so emoji usage can be correlated with CTR later. The log
// is newline-delimited JSON (one entry per line) under the app data dir; a
// bad write is swallowed (logging must never fail a publish/export).

export type TitlePipeline = "long" | "short";

export type TitleLogEntry = {
  /** Queue item id (short) or export/project id (long). */
  videoId: string;
  /** The final, decorated title as it will be published. */
  title: string;
  pipelineType: TitlePipeline;
  /** Resolved content category the decorator saw. */
  category: string;
  /** Whether an emoji was injected into this title. */
  emojiUsed: boolean;
  /** The injected glyph, or null. */
  emojiChar: string | null;
  /** ISO-8601 creation time. */
  timestamp: string;
};

/** Resolves the log path, honouring TITLE_LOG_PATH for tests / overrides. */
export function titleLogPath(override?: string): string {
  return override ?? process.env.TITLE_LOG_PATH ?? path.join(getDataRoot(), "title-log.jsonl");
}

/**
 * Appends one entry to the title log. Never throws — a logging hiccup must not
 * break the pipeline that produced the title. Returns whether the write
 * succeeded, mostly so tests can assert on it.
 */
export async function logTitle(entry: TitleLogEntry, override?: string): Promise<boolean> {
  const target = titleLogPath(override);
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(entry)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Reads and parses the title log, newest lines last. Missing file → []. */
export async function readTitleLog(override?: string): Promise<TitleLogEntry[]> {
  const target = titleLogPath(override);
  try {
    const raw = await readFile(target, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TitleLogEntry);
  } catch {
    return [];
  }
}
