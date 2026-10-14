import { describe, expect, it } from "vitest";
import { brandFieldPatch, brandKitSurface, BRAND_RESET_CONTROL } from "@/components/layout/brand-kit-surface";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/defaults";
import { resolveBrandKit } from "@/lib/brand/rules";

describe("brand kit on the canvas surface", () => {
  it("declares the editable fields with their current values", () => {
    const { fields, readings } = brandKitSurface(DEFAULT_BRAND_KIT, {});
    const byId = Object.fromEntries(fields.map((field) => [field.id, field]));
    expect(byId["brand-name"].value).toBe("Nic Vandewetering");
    expect(byId["brand-handle"].value).toBe("@nicvandewetering");
    expect(byId["brand-dashes"]).toMatchObject({ kind: "select", value: "strip", options: ["strip", "allow"] });
    expect(byId["brand-banned-phrases"].kind).toBe("longtext");
    expect(String(byId["brand-banned-phrases"].value).split("\n")).toContain("revolutionary");
    expect(byId["brand-signature-name"].value).toBe("Nic Vandewetering");
    expect(readings).toEqual([{ label: "Brand kit", value: "Built-in defaults" }]);
  });

  it("says how many things were changed from the defaults", () => {
    const { readings } = brandKitSurface(DEFAULT_BRAND_KIT, { identity: { handle: "@x" }, voice: { dashes: "allow" } });
    expect(readings[0].value).toBe("2 changes saved");
  });

  it("turns a write into a patch the kit accepts", () => {
    const patch = brandFieldPatch("brand-banned-phrases", "synergy\n  disrupt \n\n");
    expect(patch).toEqual({ voice: { bannedPhrases: ["synergy", "disrupt"] } });
    expect(resolveBrandKit(patch).kit.voice.bannedPhrases).toEqual(["synergy", "disrupt"]);
    expect(brandFieldPatch("brand-handle", "@new")).toEqual({ identity: { handle: "@new" } });
    expect(brandFieldPatch("brand-signature-name", "Someone")).toEqual({ carousel: { signature: { name: "Someone" } } });
    expect(brandFieldPatch("brand-dashes", "allow")).toEqual({ voice: { dashes: "allow" } });
  });

  it("refuses values the kit would reject, and leaves other ids alone", () => {
    expect(brandFieldPatch("brand-dashes", "sometimes")).toBeNull();
    expect(brandFieldPatch("brand-name", "")).toBeNull();
    expect(brandFieldPatch("brand-name", 5)).toBeNull();
    expect(brandFieldPatch("displayName", "x")).toBeUndefined();
  });

  it("offers a reset that is flagged as discarding saved changes", () => {
    expect(BRAND_RESET_CONTROL).toMatchObject({ id: "brand-reset", destructive: true });
  });
});
