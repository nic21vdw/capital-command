import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalizeTitle } from "./finalize";
import { readTitleLog } from "./title-log";
import { normalizeEmojiConfig, type EmojiConfig } from "./emoji-config";

const config = (overrides: Partial<EmojiConfig> = {}): EmojiConfig =>
  normalizeEmojiConfig({
    enabled: true,
    mode: "contextual",
    position: "prefix",
    maxEmoji: 1,
    category_map: { structural: ["🏗️"], default: [] },
    categoryKeywords: { structural: ["beam", "structural"] },
    ...overrides
  });

let dir: string;
let logPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "title-log-"));
  logPath = path.join(dir, "title-log.jsonl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("finalizeTitle", () => {
  it("decorates and logs a short-form title with emoji_used populated", async () => {
    const r = await finalizeTitle({
      baseTitle: "Sizing a steel beam",
      category: "structural",
      pipelineType: "short",
      videoId: "abc123",
      config: config(),
      random: () => 0,
      logPath
    });
    expect(r.title).toBe("🏗️ Sizing a steel beam");
    expect(r.emojiUsed).toBe(true);

    const log = await readTitleLog(logPath);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      videoId: "abc123",
      title: "🏗️ Sizing a steel beam",
      pipelineType: "short",
      category: "structural",
      emojiUsed: true,
      emojiChar: "🏗️"
    });
    expect(typeof log[0].timestamp).toBe("string");
  });

  it("logs long-form titles too, with emoji_used present even when false", async () => {
    const r = await finalizeTitle({
      baseTitle: "A quiet vlog with no category",
      pipelineType: "long",
      videoId: "vid-1",
      config: config(),
      logPath
    });
    expect(r.emojiUsed).toBe(false);
    expect(r.title).toBe("A quiet vlog with no category");

    const log = await readTitleLog(logPath);
    expect(log[0].pipelineType).toBe("long");
    expect(log[0].emojiUsed).toBe(false);
    expect(log[0].emojiChar).toBeNull();
    expect(log[0].category).toBe("default");
  });

  it("with emoji disabled the finalized title equals the base title", async () => {
    const base = "Exactly the same title";
    const r = await finalizeTitle({
      baseTitle: base,
      category: "structural",
      pipelineType: "short",
      videoId: "x",
      config: config({ enabled: false }),
      logPath
    });
    expect(r.title).toBe(base);
    expect(r.emojiUsed).toBe(false);

    // Logging still happens (additive), but the title output is untouched.
    const log = await readTitleLog(logPath);
    expect(log[0].title).toBe(base);
    expect(log[0].emojiUsed).toBe(false);
  });

  it("appends one line per title across a batch of clips", async () => {
    for (const id of ["c1", "c2", "c3"]) {
      await finalizeTitle({
        baseTitle: `Clip about a beam ${id}`,
        category: "beam feature",
        pipelineType: "short",
        videoId: id,
        config: config(),
        random: () => 0,
        logPath
      });
    }
    const log = await readTitleLog(logPath);
    expect(log).toHaveLength(3);
    expect(log.every((entry) => entry.emojiUsed === true)).toBe(true);
    expect(log.map((entry) => entry.videoId)).toEqual(["c1", "c2", "c3"]);
  });
});
