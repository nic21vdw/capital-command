import { isPostCode } from "@/lib/attribution/code";

export type AttributionPlatform = "youtube" | "instagram" | "tiktok" | "facebook" | "threads" | "x";

export const ATTRIBUTION_PATHS: Record<AttributionPlatform, string> = {
  youtube: "/yt",
  instagram: "/ig",
  tiktok: "/tt",
  facebook: "/fb",
  threads: "/th",
  x: "/x"
};

export const YOUTUBE_LEAD_LINE = "Try CoLateral: https://colateralai.com/yt";

const COLATERAL_LINK = /(?<![\w.@/=&?#%+~-])((?:https?:\/\/)?(?:www\.)?)colateralai\.com(?=$|[\s/?#]|,(?=https?:\/\/)|[\p{P}>]+(?:\s|$))((?:[/?#](?:(?!,https?:\/\/)\S)*)?)/giu;
const PUNCTUATION = /[\p{P}>]/u;
const URL_PUNCTUATION = new Set(["/", "#", "&", "%", "_", "-", "*", "@"]);
const OPENERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function occurrences(text: string, char: string): number {
  return text.split(char).length - 1;
}

function trailingLength(target: string): number {
  let end = target.length;
  while (end > 0) {
    const char = target[end - 1];
    if (URL_PUNCTUATION.has(char) || !PUNCTUATION.test(char)) break;
    const opener = OPENERS[char];
    if (opener && occurrences(target.slice(0, end), opener) >= occurrences(target.slice(0, end), char)) break;
    end -= 1;
  }
  return target.length - end;
}

function hasCode(query: string): boolean {
  return query.split("&").some((part) => part.split("=")[0].toLowerCase() === "c");
}

function withCode(query: string | null, code: string): string {
  if (query === null) return `c=${code}`;
  if (hasCode(query)) return query;
  if (query === "" || query.endsWith("&")) return `${query}c=${code}`;
  return `${query}&c=${code}`;
}

export function attributeLinks(text: string, platform: AttributionPlatform, code?: string): string {
  return text.replace(COLATERAL_LINK, (_match, prefix: string, rest: string | undefined) => {
    const target = rest ?? "";
    const tail = target.slice(target.length - trailingLength(target));
    const link = target.slice(0, target.length - tail.length);
    const fragmentAt = link.indexOf("#");
    const fragment = fragmentAt < 0 ? "" : link.slice(fragmentAt);
    const beforeFragment = fragmentAt < 0 ? link : link.slice(0, fragmentAt);
    const queryAt = beforeFragment.indexOf("?");
    const path = queryAt < 0 ? beforeFragment : beforeFragment.slice(0, queryAt);
    let query = queryAt < 0 ? null : beforeFragment.slice(queryAt + 1);
    const bare = (path === "" || path === "/") && query === null && fragment === "";
    if (isPostCode(code)) query = withCode(query, code);
    const destination = bare ? ATTRIBUTION_PATHS[platform] : path;
    return `${prefix}colateralai.com${destination}${query === null ? "" : `?${query}`}${fragment}${tail}`;
  });
}

export function youtubeDescription(text: string, code?: string): string {
  const body = attributeLinks(text, "youtube", code).trim();
  const firstLine = body.split("\n", 1)[0].trim();
  if (firstLine === YOUTUBE_LEAD_LINE || firstLine.startsWith(`${YOUTUBE_LEAD_LINE}?`)) return body;
  const leadLine = isPostCode(code) ? `${YOUTUBE_LEAD_LINE}?c=${code}` : YOUTUBE_LEAD_LINE;
  return body ? `${leadLine}\n\n${body}` : leadLine;
}
