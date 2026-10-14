import type { BrandKit, BrandKitOverrides } from "@/lib/brand/defaults";
import type { SurfaceControl, SurfaceField, SurfaceReading } from "@/lib/colateral/protocol";

export const BRAND_RESET_CONTROL: SurfaceControl = {
  id: "brand-reset",
  label: "Reset the brand kit to its defaults",
  group: "Brand kit",
  destructive: true,
  hint: "Discards every override saved in data/brand-kit.json."
};

const lines = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function countChanges(overrides: unknown): number {
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) return 1;
  return Object.values(overrides).reduce<number>((total, value) => total + countChanges(value), 0);
}

export function brandKitSurface(kit: BrandKit, overrides: BrandKitOverrides): { fields: SurfaceField[]; readings: SurfaceReading[] } {
  const changes = Object.keys(overrides).length === 0 ? 0 : countChanges(overrides);
  return {
    fields: [
      { id: "brand-name", label: "Brand kit: who it speaks for", value: kit.identity.name, kind: "text" },
      { id: "brand-first-name", label: "Brand kit: first name used in prompts", value: kit.identity.firstName, kind: "text" },
      { id: "brand-handle", label: "Brand kit: handle", value: kit.identity.handle, kind: "text" },
      { id: "brand-site", label: "Brand kit: website", value: kit.links.site, kind: "text" },
      { id: "brand-one-liner", label: "Brand kit: one-liner", value: kit.positioning.oneLiner, kind: "longtext" },
      {
        id: "brand-voice-rules",
        label: "Brand kit: voice rules",
        value: kit.voice.rules.join("\n"),
        kind: "longtext",
        hint: "One rule per line. Given to every AI generator."
      },
      {
        id: "brand-banned-phrases",
        label: "Brand kit: words and phrases never to use",
        value: kit.voice.bannedPhrases.join("\n"),
        kind: "longtext",
        hint: "One per line."
      },
      {
        id: "brand-dashes",
        label: "Brand kit: em and en dashes",
        value: kit.voice.dashes,
        kind: "select",
        options: ["strip", "allow"],
        hint: "strip turns a dash into a comma in every generated caption and post."
      },
      { id: "brand-signature-name", label: "Brand kit: carousel signature name", value: kit.carousel.signature.name, kind: "text" },
      { id: "brand-signature-handle", label: "Brand kit: carousel signature handle", value: kit.carousel.signature.handle, kind: "text" }
    ],
    readings: [{ label: "Brand kit", value: changes === 0 ? "Built-in defaults" : `${changes} ${changes === 1 ? "change" : "changes"} saved` }]
  };
}

export function brandFieldPatch(id: string, value: string | number | boolean | null): BrandKitOverrides | null | undefined {
  switch (id) {
    case "brand-name":
      return text(value) ? { identity: { name: text(value) } } : null;
    case "brand-first-name":
      return text(value) ? { identity: { firstName: text(value) } } : null;
    case "brand-handle":
      return typeof value === "string" ? { identity: { handle: value.trim() } } : null;
    case "brand-site":
      return text(value) ? { links: { site: text(value) } } : null;
    case "brand-one-liner":
      return text(value) ? { positioning: { oneLiner: text(value) } } : null;
    case "brand-voice-rules":
      return typeof value === "string" ? { voice: { rules: lines(value) } } : null;
    case "brand-banned-phrases":
      return typeof value === "string" ? { voice: { bannedPhrases: lines(value) } } : null;
    case "brand-dashes":
      return value === "strip" || value === "allow" ? { voice: { dashes: value } } : null;
    case "brand-signature-name":
      return typeof value === "string" ? { carousel: { signature: { name: value.trim() } } } : null;
    case "brand-signature-handle":
      return typeof value === "string" ? { carousel: { signature: { handle: value.trim() } } } : null;
    default:
      return undefined;
  }
}
