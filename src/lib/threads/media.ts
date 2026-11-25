import { mediaHost } from "@/lib/publisher/hosting";
import { PermanentError } from "@/lib/publisher/http";
import type { ThreadsMedia } from "@/lib/threads/types";

export async function resolveThreadsMedia(media: ThreadsMedia): Promise<string[]> {
  const host = mediaHost();
  if (!host) throw new PermanentError("Media hosting is not set up, so Threads has no link to fetch this post's media from. Add it in Settings > Accounts.");
  if (media.keys.length === 0) throw new PermanentError("This Threads post lists no hosted media.");
  const urls: string[] = [];
  for (const key of media.keys) urls.push(await host.publicUrl(key));
  return urls;
}
