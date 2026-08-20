import path from "node:path";
import { config } from "dotenv";

config({ path: process.env.VERIFY_ENV ?? path.join(process.cwd(), ".env"), quiet: true });

import { facebookAdapter } from "@/lib/publisher/adapters/facebook";
import { hostMedia } from "@/lib/publisher/hosting";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * Proves Facebook's native Reel scheduling against the real Page, without
 * going anywhere near the publish queue.
 *
 * Scheduling a Reel is the one thing in this app that cannot be proved by a
 * mocked test: `video_state=SCHEDULED` either holds the video until its
 * instant or it does not, and the reference does not say what a scheduled
 * Reel's status reads as afterwards. So this posts ONE real clip, at a slot
 * far enough out for Facebook to accept it, and then reads it back.
 *
 *   npm run publish:facebook:verify -- schedule <clip.mp4> [minutesFromNow]
 *   npm run publish:facebook:verify -- check <videoId>
 *
 * `check` runs the same finalize() the runner runs at the slot: before the
 * instant it must report the Reel as still scheduled and touch nothing; after
 * it, it must report it published.
 *
 * Run it from a sandbox worktree with VERIFY_ENV pointing at the production
 * .env, which is where the Page token and the media bucket live:
 *
 *   VERIFY_ENV=<production>\.env npm run publish:facebook:verify -- schedule <clip>
 *
 * It writes nothing to any queue, so the post it makes is a real post that
 * this app does not know about — delete it from the Page when you are done.
 */

function proofItem(clipPath: string, minutes: number, title: string, caption: string): QueueItem {
  return {
    id: "facebook-schedule-verification",
    clipPath,
    title,
    caption,
    hashtags: [],
    publishAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    visibility: "public",
    createdAt: new Date().toISOString(),
    platforms: { facebook: { status: "pending", attempts: 0 } }
  };
}

async function main() {
  const [, , mode, target, minutesRaw, titleRaw, captionRaw] = process.argv;

  if (mode === "schedule" && target) {
    const clipPath = path.resolve(target);
    const minutes = Number(minutesRaw ?? 20);
    const title = titleRaw ?? path.basename(clipPath, path.extname(clipPath));
    const item = proofItem(clipPath, minutes, title, captionRaw ?? title);
    console.log(`[verify] clip:      ${clipPath}`);
    console.log(`[verify] publishAt: ${item.publishAt} (${minutes} min from now)`);
    const hosted = await hostMedia(clipPath, item.id);
    console.log(`[verify] hosted:    ${hosted.url}`);
    const result = await facebookAdapter.publish({
      item,
      localPath: clipPath,
      publicUrl: hosted.url,
      pollBudgetMs: 240_000
    });
    console.log(`[verify] result:    ${JSON.stringify(result)}`);
    console.log(
      result.status === "scheduled"
        ? `[verify] Facebook is holding video ${result.postId}. Check the Page's scheduled posts, then run:\n` +
            `           npm run publish:facebook:verify -- check ${result.postId}`
        : "[verify] Facebook did NOT hold this one — it published on the finish call."
    );
    return;
  }

  if (mode === "check" && target) {
    // publishAt in the past, so finalize does what it does at a passed slot:
    // report the Reel published, or publish it if Facebook still has not.
    const item = proofItem("unused.mp4", -1, "verification", "verification");
    const result = await facebookAdapter.finalize!(item, { status: "scheduled", attempts: 1, postId: target });
    console.log(`[verify] finalize:  ${JSON.stringify(result)}`);
    return;
  }

  console.error("Usage: schedule <clip.mp4> [minutesFromNow] [title] [caption]  |  check <videoId>");
  process.exitCode = 1;
}

void main();
