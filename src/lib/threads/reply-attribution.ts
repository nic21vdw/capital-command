import { attributeLinks } from "@/lib/publisher/attribution";

// Leave room for the invitation in a 500-character Threads reply. Never shorten
// a destination to make it fit: omitting a reply is safer than a broken link.
export const THREADS_REPLY_URL_MAX_LENGTH = 350;

type ReplyUrlContext = {
  angle: string;
  origin?: "autopilot" | "pipeline";
};

const UNSAFE_URL_TEXT = /[\s\p{Cc}\p{Cf}\\]/u;
const ENCODED_CONTROLS = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const INVALID_ESCAPE = /%(?![0-9a-f]{2})/i;
const SENSITIVE_QUERY_KEY =
  /^(?:access_token|refresh_token|token|secret|key|api_key)$/i;
const REPLY_ANGLES = new Set([
  "workspace",
  "custom-tools",
  "agents",
  "engineering",
  "marketing",
  "games",
  "build-in-public",
  "general",
]);

function angleTag(angle: string): string {
  // Track editorial categories, never arbitrary post/account identifiers.
  const candidate = typeof angle === "string" ? angle.trim().toLowerCase() : "";
  return REPLY_ANGLES.has(candidate) ? candidate : "general";
}

/** Validate a reply destination and add attribution only to CoLateral's hosts. */
export function threadsReplyUrl(
  rawUrl: string,
  context: ReplyUrlContext,
): string | undefined {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length > THREADS_REPLY_URL_MAX_LENGTH ||
    !/^https?:\/\//i.test(rawUrl) ||
    UNSAFE_URL_TEXT.test(rawUrl) ||
    ENCODED_CONTROLS.test(rawUrl) ||
    INVALID_ESCAPE.test(rawUrl)
  ) {
    return undefined;
  }
  // URL() normalizes away empty userinfo and an empty authority. Require an
  // explicit host and refuse any credential delimiter before normalizing.
  const authority = rawUrl.match(/^https?:\/\/([^/?#]+)/i)?.[1];
  if (!authority || authority.includes("@")) return undefined;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (
    !url.hostname ||
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  )
    return undefined;
  // Even a custom destination is public in a reply. Decode query keys before
  // checking them so encoded or differently cased credentials cannot escape.
  if (
    [...url.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEY.test(key))
  ) {
    return undefined;
  }

  if (
    url.hostname !== "colateralai.com" &&
    url.hostname !== "www.colateralai.com"
  )
    return rawUrl;

  // Work from the original string so existing escaped query values, parameter
  // order, paths and fragments retain their exact spelling.
  const fragmentAt = rawUrl.indexOf("#");
  const fragment = fragmentAt < 0 ? "" : rawUrl.slice(fragmentAt);
  const withoutFragment = fragmentAt < 0 ? rawUrl : rawUrl.slice(0, fragmentAt);
  const queryAt = withoutFragment.indexOf("?");
  const destination =
    queryAt < 0 ? withoutFragment : withoutFragment.slice(0, queryAt);
  const query = queryAt < 0 ? "" : withoutFragment.slice(queryAt + 1);
  const attributedDestination =
    url.pathname === "/" ? attributeLinks(destination, "threads") : destination;

  const existing = new Set(
    [...url.searchParams.keys()].map((key) => key.toLowerCase()),
  );
  const additions = new URLSearchParams();
  const tracking = {
    utm_source: "threads",
    utm_medium: "social",
    utm_campaign: "colateral-exposure",
    utm_content: `${context.origin === "pipeline" ? "pipeline" : "autopilot"}-${angleTag(context.angle)}`,
  };
  for (const [key, value] of Object.entries(tracking)) {
    if (!existing.has(key)) additions.append(key, value);
  }

  const extra = additions.toString();
  const joinedQuery = extra
    ? `${query}${query && !query.endsWith("&") ? "&" : ""}${extra}`
    : query;
  const result = `${attributedDestination}${joinedQuery || queryAt >= 0 ? `?${joinedQuery}` : ""}${fragment}`;
  return result.length <= THREADS_REPLY_URL_MAX_LENGTH ? result : undefined;
}
