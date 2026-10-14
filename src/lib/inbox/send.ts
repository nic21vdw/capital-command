import { REPLY_LIMITS } from "@/lib/inbox/limits";
import { classifyFailure } from "@/lib/inbox/failures";
import { readInbox, recordReply, updateInbox } from "@/lib/inbox/store";
import { INBOX_PLATFORM_LABEL, reconnectMessage, type InboxItem, type InboxPlatform } from "@/lib/inbox/types";
import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { fetchJson } from "@/lib/publisher/http";
import { postToThreads } from "@/lib/threads/api";
import { findAccount, threadsConfig } from "@/lib/threads/config";

const YOUTUBE_REPLY_SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/youtube"];
const INSTAGRAM_REPLY_SCOPE = "instagram_manage_comments";
const FACEBOOK_REPLY_SCOPE = "pages_manage_engagement";

export class ReconnectNeededError extends Error {
  constructor(
    readonly platform: InboxPlatform,
    readonly kind: "scope" | "auth" = "scope"
  ) {
    super(reconnectMessage(platform, kind));
  }
}

export class ReplyRefusedError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400
  ) {
    super(message);
  }
}

export type SendResult = { externalId?: string; item: InboxItem };

type InflightSlot = typeof globalThis & { __inboxSending?: Set<string> };

function sending(): Set<string> {
  const slot = globalThis as InflightSlot;
  slot.__inboxSending ??= new Set();
  return slot.__inboxSending;
}

async function metaScopes(token: string): Promise<string[] | null> {
  const { appId, appSecret, graphApiVersion } = publisherConfig().instagram;
  if (!appId || !appSecret) return null;
  const query = new URLSearchParams({ input_token: token, access_token: `${appId}|${appSecret}` });
  const data = await fetchJson<{ data?: { scopes?: string[] } }>(`https://graph.facebook.com/${graphApiVersion}/debug_token?${query}`, {
    label: "Meta token inspect",
    method: "GET"
  }).catch(() => null);
  const scopes = data?.data?.scopes;
  return scopes && scopes.length > 0 ? scopes : null;
}

async function sendYoutube(item: InboxItem, text: string): Promise<string | undefined> {
  const accessToken = await youtubeAccessToken(item.accountId);
  const info = await fetchJson<{ scope?: string }>(
    `https://oauth2.googleapis.com/tokeninfo?${new URLSearchParams({ access_token: accessToken })}`,
    { label: "YouTube token inspect", method: "GET" }
  );
  const granted = (info.scope ?? "").split(/\s+/);
  if (!YOUTUBE_REPLY_SCOPES.some((scope) => granted.includes(scope))) throw new ReconnectNeededError("youtube");
  const data = await fetchJson<{ id?: string }>("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
    label: "YouTube comments.insert",
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { parentId: item.parentId ?? item.externalId, textOriginal: text } })
  });
  return data.id;
}

async function sendInstagram(item: InboxItem, text: string): Promise<string | undefined> {
  const { accessToken, graphApiVersion } = publisherConfig().instagram;
  if (!accessToken) throw new Error("Instagram is not connected.");
  const scopes = await metaScopes(accessToken);
  if (scopes && !scopes.includes(INSTAGRAM_REPLY_SCOPE)) throw new ReconnectNeededError("instagram");
  const data = await fetchJson<{ id?: string }>(
    `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(item.parentId ?? item.externalId)}/replies`,
    {
      label: "Instagram comment reply",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: text, access_token: accessToken })
    }
  );
  return data.id;
}

async function sendFacebook(item: InboxItem, text: string): Promise<string | undefined> {
  const { pageAccessToken, graphApiVersion } = publisherConfig().facebook;
  if (!pageAccessToken) throw new Error("Facebook is not connected.");
  const scopes = await metaScopes(pageAccessToken);
  if (scopes && !scopes.includes(FACEBOOK_REPLY_SCOPE)) throw new ReconnectNeededError("facebook");
  const data = await fetchJson<{ id?: string }>(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(item.externalId)}/comments`, {
    label: "Facebook comment reply",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ message: text, access_token: pageAccessToken })
  });
  return data.id;
}

async function sendThreads(item: InboxItem, text: string): Promise<string | undefined> {
  const config = threadsConfig();
  const account = findAccount(config, item.accountId);
  if (!account) throw new Error("That Threads account is not connected.");
  const posted = await postToThreads({ account, text, replyToId: item.externalId }, config);
  return posted.postId;
}

const SENDERS: Record<InboxPlatform, (item: InboxItem, text: string) => Promise<string | undefined>> = {
  youtube: sendYoutube,
  instagram: sendInstagram,
  facebook: sendFacebook,
  threads: sendThreads
};

export async function sendReply(id: string, text: string, options: { now?: Date } = {}): Promise<SendResult> {
  const now = options.now ?? new Date();
  const body = text.trim();
  if (!body) throw new ReplyRefusedError("The reply is empty.");

  const item = (await readInbox()).items.find((candidate) => candidate.id === id);
  if (!item) throw new ReplyRefusedError(`${id} is not in the inbox.`, 404);
  const limit = REPLY_LIMITS[item.platform];
  if (body.length > limit) {
    throw new ReplyRefusedError(
      `The reply is too long for ${INBOX_PLATFORM_LABEL[item.platform]} (${body.length} of ${limit} characters).`
    );
  }
  if (item.status === "replied" || item.reply) throw new ReplyRefusedError("This comment is already answered.", 409);

  const inFlight = sending();
  if (inFlight.has(id)) throw new ReplyRefusedError("A reply to this comment is already being sent.", 409);
  inFlight.add(id);
  try {
    let externalId: string | undefined;
    try {
      externalId = await SENDERS[item.platform](item, body);
    } catch (error) {
      if (error instanceof ReconnectNeededError) throw error;
      const kind = classifyFailure(error);
      if (kind === "scope" || kind === "auth") throw new ReconnectNeededError(item.platform, kind);
      throw error;
    }
    const store = await updateInbox((current) => recordReply(current, id, { text: body, externalId }, now));
    return { externalId, item: store.items.find((candidate) => candidate.id === id) as InboxItem };
  } finally {
    inFlight.delete(id);
  }
}
