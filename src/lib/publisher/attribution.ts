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

const BARE_DOMAIN = /(?<![\w.@/-])(https?:\/\/)?(www\.)?colateralai\.com\/?(?=$|\s|[)\]}>"'.,!?;:]+(?:\s|$))/gi;

function codeQuery(code: string | undefined): string {
  return isPostCode(code) ? `?c=${code}` : "";
}

export function attributeLinks(text: string, platform: AttributionPlatform, code?: string): string {
  const path = ATTRIBUTION_PATHS[platform] + codeQuery(code);
  return text.replace(BARE_DOMAIN, (_match, scheme: string | undefined, www: string | undefined) => {
    return `${scheme ?? ""}${www ?? ""}colateralai.com${path}`;
  });
}

export function youtubeDescription(text: string, code?: string): string {
  const body = attributeLinks(text, "youtube", code).trim();
  const firstLine = body.split("\n", 1)[0].trim();
  if (firstLine === YOUTUBE_LEAD_LINE || firstLine.startsWith(`${YOUTUBE_LEAD_LINE}?`)) return body;
  const leadLine = `${YOUTUBE_LEAD_LINE}${codeQuery(code)}`;
  return body ? `${leadLine}\n\n${body}` : leadLine;
}
