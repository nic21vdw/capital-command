import { getRun, updateRun } from "@/lib/pipeline/runs";
import { planAdhocPosts } from "@/lib/threads/adhoc";
import { threadsConfig } from "@/lib/threads/config";
import { mutateQueue } from "@/lib/threads/queue";

// The text posts a stream produced, onto the Threads queue the autopilot
// already drains. Copying four posts into three apps by hand was the last
// output of a run that had no route out of the app at all.

export type QueuePostsResult = { scheduled: number; firstAt?: string; note?: string };

export async function queueRunPosts(runId: string): Promise<QueuePostsResult> {
  const run = await getRun(runId);
  if (!run) throw new Error(`No pipeline run called ${runId}.`);
  const posts = run.posts ?? [];
  if (posts.length === 0) throw new Error("This run has no text posts to schedule.");
  if (run.postsQueuedAt) throw new Error("These posts are already on the queue.");

  const config = threadsConfig();
  if (!config.enabled || config.accounts.length === 0) {
    throw new Error("No Threads account is connected, so there is nowhere to schedule these.");
  }

  // Threads is the only text platform the app can post to on its own. The X and
  // Facebook versions stay copyable rather than silently dropped.
  const threadsPosts = posts.filter((post) => post.platform === "threads");
  const others = posts.length - threadsPosts.length;
  if (threadsPosts.length === 0) {
    throw new Error("None of these posts are written for Threads, which is the only one the app can post itself.");
  }

  const now = new Date();
  const items = await mutateQueue((current) => {
    const taken = new Set(current.map((item) => item.publishAt));
    const planned = planAdhocPosts({
      texts: threadsPosts.map((post) => post.text),
      config,
      now,
      taken,
      runId
    });
    return { items: [...current, ...planned], result: planned };
  });

  await updateRun(run, { postsQueuedAt: new Date().toISOString() });
  return {
    scheduled: items.length,
    firstAt: items[0]?.publishAt,
    note: others > 0 ? `${others} written for X or Facebook stay here to copy.` : undefined
  };
}
