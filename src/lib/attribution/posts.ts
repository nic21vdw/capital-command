import { publishQueue } from "@/lib/publisher/queue";
import { readQueue } from "@/lib/threads/queue";
import { postLabels, type PostLabel } from "@/lib/attribution/view";

export async function attributionPostLabels(): Promise<PostLabel[]> {
  const [publishPosts, threadsPosts] = await Promise.all([publishQueue().list(), readQueue()]);
  return postLabels(publishPosts, threadsPosts);
}
