import { fetchFacebookComments } from "@/lib/inbox/fetch/facebook";
import type { FetchOptions, FetchResult } from "@/lib/inbox/fetch/common";
import { fetchInstagramComments } from "@/lib/inbox/fetch/instagram";
import { fetchThreadsReplies } from "@/lib/inbox/fetch/threads";
import { fetchYoutubeComments } from "@/lib/inbox/fetch/youtube";
import type { InboxPlatform, PublishedPost } from "@/lib/inbox/types";
import { publisherAccountLabel } from "@/lib/platform-health/account";
import { publisherAccountFingerprint, threadsAccountFingerprint } from "@/lib/platform-health/fingerprint";
import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { instagramProfile } from "@/lib/publisher/metaProfile";
import { fetchThreadsProfile } from "@/lib/threads/api";
import { findAccount, threadsConfig } from "@/lib/threads/config";

export type PostFetcher = (post: PublishedPost, since: string | null, options: FetchOptions) => Promise<FetchResult>;

export type Lane = {
  platform: InboxPlatform;
  accountId: string;
  label: string | null;
  fingerprint: string | null;
  open: () => Promise<PostFetcher>;
};

export async function resolveLane(platform: InboxPlatform, accountId: string): Promise<Lane | null> {
  const config = publisherConfig();

  if (platform === "youtube") {
    const fingerprint = await publisherAccountFingerprint("youtube", accountId, config);
    if (!config.youtube.clientId || !config.youtube.clientSecret || !fingerprint) return null;
    return {
      platform,
      accountId,
      label: await publisherAccountLabel("youtube", accountId),
      fingerprint,
      open: async () => {
        const accessToken = await youtubeAccessToken(accountId);
        return (post, since, options) => fetchYoutubeComments(post, since, { accessToken }, options);
      }
    };
  }

  if (platform === "instagram") {
    const { accessToken, userId, graphApiVersion } = config.instagram;
    if (!accessToken || !userId) return null;
    return {
      platform,
      accountId,
      label: null,
      fingerprint: await publisherAccountFingerprint("instagram", accountId, config),
      open: async () => {
        const selfUsername = (await instagramProfile(config))?.handle ?? null;
        return (post, since, options) => fetchInstagramComments(post, since, { accessToken, graphApiVersion, selfUsername }, options);
      }
    };
  }

  if (platform === "facebook") {
    const { pageAccessToken, pageId, graphApiVersion } = config.facebook;
    if (!pageAccessToken || !pageId) return null;
    return {
      platform,
      accountId,
      label: null,
      fingerprint: await publisherAccountFingerprint("facebook", accountId, config),
      open: async () => (post, since, options) =>
        fetchFacebookComments(post, since, { accessToken: pageAccessToken, graphApiVersion, pageId }, options)
    };
  }

  const threads = threadsConfig();
  const account = findAccount(threads, accountId);
  if (!account) return null;
  return {
    platform,
    accountId,
    label: account.label,
    fingerprint: threadsAccountFingerprint(account),
    open: async () => {
      const selfUsername = (await fetchThreadsProfile(account, threads)).username;
      return (post, since, options) =>
        fetchThreadsReplies(
          post,
          since,
          { accessToken: account.accessToken, apiBase: threads.apiBase, apiVersion: threads.apiVersion, selfUsername },
          options
        );
    }
  };
}
