import { classifyFailure } from "@/lib/inbox/failures";
import { REPLY_LIMITS } from "@/lib/inbox/limits";
import { recordReply, setSendRecord, updateInbox } from "@/lib/inbox/store";
import { INBOX_PLATFORM_LABEL, reconnectMessage, type InboxItem, type InboxPlatform } from "@/lib/inbox/types";
import { YOUTUBE_REPLY_UNITS, chargeYoutubeUnits } from "@/lib/inbox/youtubeUnits";
import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { fetchJson } from "@/lib/publisher/http";
import { accountUserId, publishContainer } from "@/lib/threads/api";
import { findAccount, threadsConfig } from "@/lib/threads/config";

const YOUTUBE_REPLY_SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/youtube"];
const INSTAGRAM_REPLY_SCOPE = "instagram_manage_comments";
const FACEBOOK_REPLY_SCOPE = "pages_manage_engagement";
const DEFAULT_RETRY_DELAYS_MS = [100, 400, 1000];

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
    readonly status: 400 | 404 | 409 = 400,
    readonly kind?: "send-unknown"
  ) {
    super(message);
  }
}

export class SendUnknownError extends Error {
  readonly kind = "send-unknown" as const;
}

export class ReplyUnrecordedError extends Error {
  readonly kind = "send-unknown" as const;
}

class NotPosted extends Error {
  constructor(readonly original: unknown) {
    super("The reply was not posted.");
  }
}

export type SendResult = { externalId?: string; item: InboxItem };

export type SendOptions = {
  now?: Date;
  override?: boolean;
  retryDelaysMs?: number[];
};

type InflightSlot = typeof globalThis & { __inboxSending?: Set<string> };

function sending(): Set<string> {
  const slot = globalThis as InflightSlot;
  slot.__inboxSending ??= new Set();
  return slot.__inboxSending;
}

function checkFirst(platform: InboxPlatform): string {
  return `Check the platform first (open the comment on ${INBOX_PLATFORM_LABEL[platform]}), then send anyway if your reply is not there.`;
}

function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

function rejectedByPlatform(error: unknown): boolean {
  const status = /\(HTTP (\d{3})\)/.exec(error instanceof Error ? error.message : "")?.[1];
  return status !== undefined && status.startsWith("4") && status !== "408";
}

async function withRetry<T>(work: () => Promise<T>, delaysMs: number[]): Promise<T> {
  let failure: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      failure = error;
      if (attempt < delaysMs.length) await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
  throw failure;
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

type Post = () => Promise<string | undefined>;

async function prepareYoutube(item: InboxItem, text: string, now: Date): Promise<Post> {
  const accessToken = await youtubeAccessToken(item.accountId);
  const info = await fetchJson<{ scope?: string }>(
    `https://oauth2.googleapis.com/tokeninfo?${new URLSearchParams({ access_token: accessToken })}`,
    { label: "YouTube token inspect", method: "GET" }
  );
  const granted = (info.scope ?? "").split(/\s+/);
  if (!YOUTUBE_REPLY_SCOPES.some((scope) => granted.includes(scope))) throw new ReconnectNeededError("youtube");
  await chargeYoutubeUnits(now, YOUTUBE_REPLY_UNITS);
  return async () => {
    const data = await fetchJson<{ id?: string }>("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
      label: "YouTube comments.insert",
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ snippet: { parentId: item.parentId ?? item.externalId, textOriginal: text } })
    });
    return data.id;
  };
}

async function prepareInstagram(item: InboxItem, text: string): Promise<Post> {
  const { accessToken, userId, graphApiVersion } = publisherConfig().instagram;
  if (!accessToken) throw new Error("Instagram is not connected.");
  const scopes = await metaScopes(accessToken);
  if (scopes && !scopes.includes(INSTAGRAM_REPLY_SCOPE)) throw new ReconnectNeededError("instagram");
  const base = `https://graph.facebook.com/${graphApiVersion}`;
  const form = { "Content-Type": "application/x-www-form-urlencoded" };

  if (item.kind === "mention") {
    if (!userId) throw new Error("Instagram is not connected.");
    return async () =>
      (
        await fetchJson<{ id?: string }>(`${base}/${encodeURIComponent(userId)}/mentions`, {
          label: "Instagram mention reply",
          headers: form,
          body: new URLSearchParams({ media_id: item.postId, comment_id: item.externalId, message: text, access_token: accessToken })
        })
      ).id;
  }

  return async () =>
    (
      await fetchJson<{ id?: string }>(`${base}/${encodeURIComponent(item.parentId ?? item.externalId)}/replies`, {
        label: "Instagram comment reply",
        headers: form,
        body: new URLSearchParams({ message: text, access_token: accessToken })
      })
    ).id;
}

async function prepareFacebook(item: InboxItem, text: string): Promise<Post> {
  const { pageAccessToken, graphApiVersion } = publisherConfig().facebook;
  if (!pageAccessToken) throw new Error("Facebook is not connected.");
  const scopes = await metaScopes(pageAccessToken);
  if (scopes && !scopes.includes(FACEBOOK_REPLY_SCOPE)) throw new ReconnectNeededError("facebook");
  return async () =>
    (
      await fetchJson<{ id?: string }>(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(item.externalId)}/comments`, {
        label: "Facebook comment reply",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message: text, access_token: pageAccessToken })
      })
    ).id;
}

async function prepareThreads(item: InboxItem, text: string): Promise<Post> {
  const config = threadsConfig();
  const account = findAccount(config, item.accountId);
  if (!account) throw new Error("That Threads account is not connected.");
  const userId = await accountUserId(account, config);
  const withId = { ...account, userId };
  return async () => {
    let containerId: string;
    try {
      const created = await fetchJson<{ id?: string }>(`${config.apiBase}/${config.apiVersion}/${encodeURIComponent(userId)}/threads`, {
        label: `Threads reply container (${account.label})`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ media_type: "TEXT", text, reply_to_id: item.externalId, access_token: account.accessToken })
      });
      if (!created.id) throw new Error("Threads accepted the reply but returned no container id.");
      containerId = created.id;
    } catch (error) {
      throw new NotPosted(error);
    }
    return publishContainer(withId, containerId, config);
  };
}

const PREPARE: Record<InboxPlatform, (item: InboxItem, text: string, now: Date) => Promise<Post>> = {
  youtube: prepareYoutube,
  instagram: prepareInstagram,
  facebook: prepareFacebook,
  threads: prepareThreads
};

async function execute(item: InboxItem, text: string, now: Date): Promise<string | undefined> {
  let post: Post;
  try {
    post = await PREPARE[item.platform](item, text, now);
  } catch (error) {
    throw new NotPosted(error);
  }
  try {
    return await post();
  } catch (error) {
    if (error instanceof NotPosted) throw error;
    if (rejectedByPlatform(error)) throw new NotPosted(error);
    throw error;
  }
}

function refusalFor(platform: InboxPlatform, original: unknown): unknown {
  if (original instanceof ReconnectNeededError) return original;
  const kind = classifyFailure(original);
  return kind === "scope" || kind === "auth" ? new ReconnectNeededError(platform, kind) : original;
}

export async function sendReply(id: string, text: string, options: SendOptions = {}): Promise<SendResult> {
  const body = text.trim();
  if (!body) throw new ReplyRefusedError("The reply is empty.");

  const inFlight = sending();
  if (inFlight.has(id)) throw new ReplyRefusedError("A reply to this comment is already being sent.", 409);
  inFlight.add(id);
  try {
    return await sendClaimed(id, body, options);
  } finally {
    inFlight.delete(id);
  }
}

async function sendClaimed(id: string, body: string, options: SendOptions): Promise<SendResult> {
  const now = options.now ?? new Date();
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  let claimed: InboxItem | undefined;

  await updateInbox((current) => {
    const item = current.items.find((candidate) => candidate.id === id);
    if (!item) throw new ReplyRefusedError(`${id} is not in the inbox.`, 404);
    const limit = REPLY_LIMITS[item.platform];
    if (body.length > limit) {
      throw new ReplyRefusedError(
        `The reply is too long for ${INBOX_PLATFORM_LABEL[item.platform]} (${body.length} of ${limit} characters).`
      );
    }
    if (item.status === "replied" || item.reply) throw new ReplyRefusedError("This comment is already answered.", 409);
    if (item.send && !options.override) {
      throw new ReplyRefusedError(
        `An earlier attempt to reply here may already have been posted. ${checkFirst(item.platform)}`,
        409,
        "send-unknown"
      );
    }
    claimed = item;
    return setSendRecord(current, id, { state: "sending", at: now.toISOString(), text: body });
  });
  const item = claimed as InboxItem;

  let externalId: string | undefined;
  try {
    externalId = await execute(item, body, now);
  } catch (error) {
    if (error instanceof NotPosted) {
      await updateInbox((current) => setSendRecord(current, id, null)).catch(() => undefined);
      throw refusalFor(item.platform, error.original);
    }
    const detail = shortError(error);
    await updateInbox((current) =>
      setSendRecord(current, id, { state: "send-unknown", at: now.toISOString(), text: body, error: detail })
    ).catch(() => undefined);
    throw new SendUnknownError(
      `${INBOX_PLATFORM_LABEL[item.platform]} did not confirm the reply (${detail}). It may already be posted. ${checkFirst(item.platform)}`
    );
  }

  try {
    const store = await withRetry(() => updateInbox((current) => recordReply(current, id, { text: body, externalId }, now)), delays);
    return { externalId, item: store.items.find((candidate) => candidate.id === id) as InboxItem };
  } catch (error) {
    throw new ReplyUnrecordedError(
      `The reply was posted on ${INBOX_PLATFORM_LABEL[item.platform]} but could not be saved here (${shortError(error)}). Do not send it again.`
    );
  }
}
