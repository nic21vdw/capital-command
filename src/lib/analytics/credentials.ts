import type { AnalyticsCredentials } from "@/lib/analytics/sync";
import { publisherAccountLabel } from "@/lib/platform-health/account";
import { currentFingerprint } from "@/lib/platform-health/fingerprint";
import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { youtubeRefreshTokenFor } from "@/lib/publisher/googleAuth";
import { tiktokAccessToken, TIKTOK_SCOPE } from "@/lib/publisher/tiktokAuth";
import { threadsConfig } from "@/lib/threads/config";
import { isPrimaryAccountId } from "@/lib/publisher/accounts";

const GRAPH_HOST = "https://graph.facebook.com";

export function liveCredentials(): AnalyticsCredentials {
  return {
    async youtube(accountId) {
      const { youtube } = publisherConfig();
      if (!youtube.clientId || !youtube.clientSecret) return null;
      if (!(await youtubeRefreshTokenFor(accountId))) return null;
      return { token: await youtubeAccessToken(accountId) };
    },
    async instagram(accountId) {
      const { instagram } = publisherConfig();
      if (!isPrimaryAccountId(accountId) || !instagram.userId || !instagram.accessToken) return null;
      return { token: instagram.accessToken, graphBase: `${GRAPH_HOST}/${instagram.graphApiVersion}` };
    },
    async facebook(accountId) {
      const { facebook } = publisherConfig();
      if (!isPrimaryAccountId(accountId) || !facebook.pageId || !facebook.pageAccessToken) return null;
      return { token: facebook.pageAccessToken, graphBase: `${GRAPH_HOST}/${facebook.graphApiVersion}` };
    },
    async threads(accountId) {
      const config = threadsConfig();
      const account = config.accounts.find((candidate) => candidate.id === accountId);
      return account ? { token: account.accessToken, base: `${config.apiBase}/${config.apiVersion}` } : null;
    },
    async tiktok(accountId) {
      const token = await tiktokAccessToken(accountId);
      return token ? { token } : null;
    },
    tiktokScopes: () => TIKTOK_SCOPE,
    async fingerprint(platform, accountId) {
      return (await currentFingerprint(platform, accountId)) ?? null;
    },
    async label(platform, accountId) {
      if (platform === "threads") return threadsConfig().accounts.find((candidate) => candidate.id === accountId)?.label ?? null;
      return publisherAccountLabel(platform, accountId);
    }
  };
}
