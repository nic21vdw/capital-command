import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { youtubeAdapter } from "@/lib/publisher/adapters/youtube";
import { itemAccountId } from "@/lib/publisher/accounts";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import { MarketingLedgerError, type ArtifactEvidence } from "./ledger";

function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function invalid(): never { throw new MarketingLedgerError("unavailable", "A stable rendered video and complete platform payload are required."); }

/**
 * Reads actual local bytes and reuses the publisher's complete YouTube body.
 * Other buildPlan implementations contain placeholders (hosted URLs, chunk sizes
 * or provider summaries); do not label those complete exact-review payloads.
 * Neither configured(), validateAuth(), publish() nor finalize() is called.
 */
export function createYouTubeArtifactReader(config: { projectRoot: string; mediaRoot: string }) {
  return async (item: Readonly<QueueItem>, platform: PlatformId): Promise<ArtifactEvidence> => {
    if (platform !== "youtube" || item.mediaKind === "image") return invalid();
    const root = await realpath(config.mediaRoot);
    const requested = path.resolve(config.projectRoot, item.clipPath);
    const file = await realpath(requested);
    if (!contained(root, file) || !/\.(mp4|webm|mov|mkv)$/i.test(file)) return invalid();
    const handle = await open(file, "r");
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.size <= 0n || before.size > 2_147_483_648n) return invalid();
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(256 * 1024);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
      }
      const after = await handle.stat({ bigint: true });
      const signature = (value: typeof before) => `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`;
      if (signature(before) !== signature(after)) return invalid();
      const expected = signature(after);
      const assertFileCurrent = () => {
        if (realpathSync(requested) !== file || signature(statSync(file, { bigint: true })) !== expected) return invalid();
      };
      assertFileCurrent();
      const sha256 = hash.digest("hex");
      const plan = youtubeAdapter.buildPlan({ item: structuredClone(item), localPath: file });
      const description = (plan.payload.snippet as { description?: unknown })?.description;
      if (typeof description !== "string" || !description) return invalid();
      const digestPlan = (current: typeof plan) => createHash("sha256").update(JSON.stringify({
        platform, accountId: itemAccountId(item, platform), artifactSha256: sha256,
        endpoint: current.endpoint, payload: current.payload, publishAt: current.publishAtUtc,
        finalVisibility: item.visibility, finalAudience: item.visibility
      })).digest("hex");
      const payloadSha256 = digestPlan(plan);
      const assertCurrent = () => {
        assertFileCurrent();
        if (digestPlan(youtubeAdapter.buildPlan({ item: structuredClone(item), localPath: file })) !== payloadSha256) return invalid();
      };
      return { sha256, finalCaption: description, payloadSha256, assertCurrent };
    } finally { await handle.close(); }
  };
}
