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

export function attributeLinks(text: string, platform: AttributionPlatform): string {
  const path = ATTRIBUTION_PATHS[platform];
  return text.replace(BARE_DOMAIN, (_match, scheme: string | undefined, www: string | undefined) => {
    return `${scheme ?? ""}${www ?? ""}colateralai.com${path}`;
  });
}

export function youtubeDescription(text: string): string {
  const body = attributeLinks(text, "youtube").trim();
  if (body.split("\n", 1)[0].trim() === YOUTUBE_LEAD_LINE) return body;
  return body ? `${YOUTUBE_LEAD_LINE}\n\n${body}` : YOUTUBE_LEAD_LINE;
}
