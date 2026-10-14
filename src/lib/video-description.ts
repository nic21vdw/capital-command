import { DEFAULT_BRAND_KIT, type BrandKit } from "@/lib/brand/defaults";

export function videoDescriptionFor(kit: BrandKit): string {
  return `I'm building CoLateral in public. ${kit.positioning.description}

These videos show the real work behind it: new features, AI workflows, experiments, mistakes and the decisions that go into shipping software with Claude Code, Codex and other AI tools.

Explore CoLateral: ${kit.links.site}
Watch the full build: ${kit.links.youtube}
Follow updates: ${kit.links.x}`;
}

export function videoKeywordsFor(kit: BrandKit): string {
  return kit.vocabulary.keywords.join(", ");
}

export const DEFAULT_VIDEO_DESCRIPTION = videoDescriptionFor(DEFAULT_BRAND_KIT);

export const DEFAULT_VIDEO_KEYWORDS = videoKeywordsFor(DEFAULT_BRAND_KIT);
