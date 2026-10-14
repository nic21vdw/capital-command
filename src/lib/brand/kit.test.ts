import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BRAND_CHANNELS, DEFAULT_BRAND_KIT, brandKitSchema } from "@/lib/brand/defaults";
import {
  BrandKitInvalidError,
  applyBrandRules,
  brandHashtagPolicy,
  brandKit,
  brandKitPath,
  brandKitResolution,
  brandPromptBlock,
  brandViolations,
  resetBrandKit,
  saveBrandKitOverrides
} from "@/lib/brand/kit";
import { pruneOverrides, resolveBrandKit, stripDashes } from "@/lib/brand/rules";

const MESSAGING = readFileSync(path.join(process.cwd(), "docs", "colateral-messaging.md"), "utf8").replace(/\r\n/g, "\n");

const flat = (text: string) =>
  text
    .replace(/^>\s?/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("defaults derived from docs/colateral-messaging.md", () => {
  it("carries the one-liner word for word", () => {
    const quoted = MESSAGING.split("### The one-liner")[1].split("###")[0];
    expect(flat(quoted.split("\n").filter((row) => row.startsWith(">")).join("\n"))).toBe(DEFAULT_BRAND_KIT.positioning.oneLiner);
  });

  it("carries the four pillars and their claims", () => {
    const rows = MESSAGING.split("## 2. The pillars")[1]
      .split("\n---\n")[0]
      .split("\n")
      .filter((row) => /^\| \*\*/.test(row))
      .map((row) => row.split("|").map((cell) => flat(cell)))
      .map((cells) => ({ name: cells[1], claim: cells[2] }));
    expect(rows).toHaveLength(4);
    expect(DEFAULT_BRAND_KIT.positioning.pillars).toEqual(rows);
  });

  it("carries the vocabulary the doc says to use", () => {
    const section = MESSAGING.split("**Use these words:**")[1].split("**Audience:**")[0];
    const terms = section
      .split("\n")
      .filter((row) => row.startsWith("- "))
      .flatMap((row) => row.slice(2).split("·"))
      .map((term) => term.trim())
      .filter(Boolean);
    expect(terms.length).toBeGreaterThan(8);
    for (const term of terms) expect(DEFAULT_BRAND_KIT.vocabulary.use).toContain(term);
  });

  it("carries the reusable copy blocks and the palette", () => {
    const blocks = MESSAGING.split("## 6. Reusable copy blocks")[1];
    const quoted = (label: string) => flat(blocks.match(new RegExp(`\\*\\*${label}:\\*\\* (.+)`))![1]);
    expect(quoted("Eyebrow")).toBe(DEFAULT_BRAND_KIT.positioning.eyebrow);
    expect(quoted("Tagline")).toBe(DEFAULT_BRAND_KIT.positioning.tagline);
    expect(quoted("Trustline")).toBe(DEFAULT_BRAND_KIT.positioning.trustline);
    expect(quoted("Wordmark")).toBe(DEFAULT_BRAND_KIT.logo.wordmark);
    const hexes = blocks.match(/#[0-9a-f]{6}/g) ?? [];
    expect([...new Set(hexes)].sort()).toEqual(Object.values(DEFAULT_BRAND_KIT.palette).sort());
  });

  it("forbids what the doc says never to say", () => {
    const claims = DEFAULT_BRAND_KIT.voice.bannedClaims.join(" ");
    expect(claims).toContain("CoLateral Engineering");
    for (const word of ["certified", "stamped", "code-approved", "guarantees compliance"]) expect(claims).toContain(word);
    expect(MESSAGING).toContain("**\"CoLateral Engineering\"**");
  });

  it("is a valid kit with every channel configured", () => {
    expect(brandKitSchema.safeParse(DEFAULT_BRAND_KIT).success).toBe(true);
    expect(Object.keys(DEFAULT_BRAND_KIT.channels).sort()).toEqual([...BRAND_CHANNELS].sort());
  });
});

describe("merge and overrides", () => {
  it("returns the defaults when there are no overrides", () => {
    expect(resolveBrandKit(undefined).kit).toEqual(DEFAULT_BRAND_KIT);
    expect(resolveBrandKit({}).kit).toEqual(DEFAULT_BRAND_KIT);
  });

  it("merges objects field by field and replaces arrays whole", () => {
    const { kit, issues } = resolveBrandKit({
      identity: { handle: "@someone" },
      voice: { bannedPhrases: ["synergy"] },
      channels: { threads: { cta: { url: "https://example.com/th" } } }
    });
    expect(issues).toEqual([]);
    expect(kit.identity.handle).toBe("@someone");
    expect(kit.identity.name).toBe(DEFAULT_BRAND_KIT.identity.name);
    expect(kit.voice.bannedPhrases).toEqual(["synergy"]);
    expect(kit.channels.threads.cta).toEqual({ line: DEFAULT_BRAND_KIT.channels.threads.cta.line, url: "https://example.com/th" });
    expect(kit.channels.youtube).toEqual(DEFAULT_BRAND_KIT.channels.youtube);
  });

  it("rejects an override that breaks the schema and keeps the defaults", () => {
    const { kit, issues } = resolveBrandKit({ channels: { youtube: { hashtags: { max: 500 } } } });
    expect(issues.join(" ")).toContain("channels.youtube.hashtags.max");
    expect(kit).toEqual(DEFAULT_BRAND_KIT);
  });

  it("drops keys the kit does not have", () => {
    const { kit, overrides } = resolveBrandKit({ nonsense: true, identity: { handle: "@x", mood: "loud" } });
    expect(overrides).toEqual({ identity: { handle: "@x" } });
    expect(kit.identity.handle).toBe("@x");
  });

  it("prunes values that equal the defaults so later default changes still flow", () => {
    const pruned = pruneOverrides(DEFAULT_BRAND_KIT, {
      identity: { name: DEFAULT_BRAND_KIT.identity.name, handle: "@new" },
      voice: { dashes: "strip" }
    });
    expect(pruned).toEqual({ identity: { handle: "@new" } });
  });
});

describe("the data file", () => {
  let dir: string;
  const previous = process.env.CAPITAL_COMMAND_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "brand-kit-"));
    process.env.CAPITAL_COMMAND_DATA_DIR = dir;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.CAPITAL_COMMAND_DATA_DIR;
    else process.env.CAPITAL_COMMAND_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses the defaults when data/brand-kit.json does not exist", () => {
    expect(brandKit()).toEqual(DEFAULT_BRAND_KIT);
    expect(brandKitResolution().issues).toEqual([]);
  });

  it("writes only what differs from the defaults, and generators see it at once", async () => {
    expect(brandKit().identity.handle).toBe("@nicvandewetering");
    await saveBrandKitOverrides({ identity: { handle: "@changed", name: DEFAULT_BRAND_KIT.identity.name } });
    expect(JSON.parse(readFileSync(brandKitPath(), "utf8"))).toEqual({ identity: { handle: "@changed" } });
    expect(brandKit().identity.handle).toBe("@changed");
    expect(brandPromptBlock("youtube")).toContain("Brand kit for this piece");
  });

  it("refuses an invalid save and leaves the file alone", async () => {
    await saveBrandKitOverrides({ identity: { handle: "@kept" } });
    await expect(saveBrandKitOverrides({ identity: { name: "" } })).rejects.toBeInstanceOf(BrandKitInvalidError);
    await expect(saveBrandKitOverrides([])).rejects.toBeInstanceOf(BrandKitInvalidError);
    expect(brandKit().identity.handle).toBe("@kept");
  });

  it("resets to the defaults", async () => {
    await saveBrandKitOverrides({ voice: { bannedPhrases: ["synergy"] } });
    expect(brandKit().voice.bannedPhrases).toEqual(["synergy"]);
    await resetBrandKit();
    expect(brandKit()).toEqual(DEFAULT_BRAND_KIT);
  });

  it("falls back to the defaults, and says so, when the file is corrupt", () => {
    writeFileSync(brandKitPath(), "{ not json");
    expect(brandKit()).toEqual(DEFAULT_BRAND_KIT);
    expect(brandKitResolution().issues[0]).toContain("could not be read");
  });

  it("falls back to the defaults when the file holds an invalid kit", () => {
    writeFileSync(brandKitPath(), JSON.stringify({ channels: { threads: { emoji: "lots" } } }));
    expect(brandKit()).toEqual(DEFAULT_BRAND_KIT);
    expect(brandKitResolution().issues.length).toBeGreaterThan(0);
  });
});

describe("brandPromptBlock", () => {
  it("names who is speaking, the products and the retired name", () => {
    const block = brandPromptBlock("youtube");
    expect(block).toContain("Nic Vandewetering");
    expect(block).toContain("CoLateral Marketing");
    expect(block).toContain("Capital Command");
    expect(block).toContain("never use them");
  });

  it("carries the voice rules, banned phrases, claims and the dash rule", () => {
    const block = brandPromptBlock("launch");
    for (const phrase of DEFAULT_BRAND_KIT.voice.bannedPhrases) expect(block).toContain(phrase);
    expect(block).toContain("CoLateral Engineering");
    expect(block).toContain("Never an em dash or an en dash");
    expect(block).toContain("Never ask anyone to upvote");
  });

  it("differs per channel: plain-talk jargon bans, hashtags, keywords and links", () => {
    const threads = brandPromptBlock("threads");
    expect(threads).toContain("verification loop");
    expect(threads).toContain("Hashtags: none.");
    expect(threads).not.toContain("Channel keywords");
    expect(threads).toContain("Write the way Nic talks");

    const shorts = brandPromptBlock("youtube");
    expect(shorts).toContain("Always include #shorts");
    expect(shorts).toContain("Channel keywords");
    expect(shorts).not.toContain("verification loop");
    expect(shorts).toContain("https://colateralai.com/yt");
  });

  it("can ask for the keywords on a channel that does not default to them", () => {
    expect(brandPromptBlock("threads", { keywords: true })).toContain("Channel keywords");
  });

  it("follows an override", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brand-kit-"));
    const previous = process.env.CAPITAL_COMMAND_DATA_DIR;
    process.env.CAPITAL_COMMAND_DATA_DIR = dir;
    try {
      await saveBrandKitOverrides({ identity: { name: "Ada Lovelace", firstName: "Ada" }, voice: { bannedPhrases: ["synergy"] } });
      const block = brandPromptBlock("threads");
      expect(block).toContain("Ada Lovelace");
      expect(block).toContain("Write the way Ada talks");
      expect(block).toContain("synergy");
      expect(block).not.toContain("revolutionary");
    } finally {
      if (previous === undefined) delete process.env.CAPITAL_COMMAND_DATA_DIR;
      else process.env.CAPITAL_COMMAND_DATA_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("applyBrandRules", () => {
  it("turns a dash doing punctuation work into a comma, like someone typing fast", () => {
    expect(applyBrandRules("It is not about speed — it is about judgment", "threads")).toBe("It is not about speed, it is about judgment");
    expect(applyBrandRules("One thing – another thing", "youtube")).toBe("One thing, another thing");
  });

  it("keeps ranges, bullets and line breaks", () => {
    expect(applyBrandRules("Scored 3—1 today", "x")).toBe("Scored 3-1 today");
    expect(applyBrandRules("— first\n— second", "instagram")).toBe("- first\n- second");
    expect(applyBrandRules("line one —\nline two", "facebook")).toBe("line one,\nline two");
  });

  it("agrees with the original Threads dash remover", () => {
    for (const sample of ["a — b", "a—b", "wait — what", "end —", "— start", "1—2 and 3 – 4", "yes — , no"]) {
      expect(applyBrandRules(sample, "threads")).toBe(stripDashes(sample));
    }
  });

  it("writes the product name the way the brand does, and leaves links, handles and tags alone", () => {
    expect(applyBrandRules("colateral and Co-Lateral and COLATERAL", "threads")).toBe("CoLateral and CoLateral and CoLateral");
    const guarded = "See https://colateralai.com/yt and @colateral and #colateral and www.colateralai.com";
    expect(applyBrandRules(guarded, "youtube")).toBe(guarded);
    expect(applyBrandRules("collateral damage", "youtube")).toBe("collateral damage");
  });

  it("swaps the words the kit substitutes and keeps their capital", () => {
    expect(applyBrandRules("We utilize it. Utilize more.", "youtube")).toBe("We use it. Use more.");
  });

  it("is idempotent", () => {
    const once = applyBrandRules("colateral — is a canvas – really", "threads");
    expect(applyBrandRules(once, "threads")).toBe(once);
  });

  it("leaves spoken-only channels as they are", () => {
    expect(applyBrandRules("a — b", "voice")).toBe("a — b");
    expect(applyBrandRules("a — b", "script")).toBe("a — b");
  });

  it("respects a kit that allows dashes", () => {
    const { kit } = resolveBrandKit({ voice: { dashes: "allow" } });
    expect(kit.voice.dashes).toBe("allow");
  });
});

describe("brandViolations", () => {
  it("flags banned phrases, claims, the retired name and dashes", () => {
    const kinds = (text: string, channel: Parameters<typeof brandViolations>[1]) => brandViolations(text, channel).map((violation) => violation.kind);
    expect(kinds("A revolutionary tool", "youtube")).toContain("banned-phrase");
    expect(kinds("Now certified for compliance", "youtube")).toContain("banned-claim");
    expect(kinds("Capital Command is live", "threads")).toContain("retired-name");
    expect(kinds("one — two", "threads")).toContain("dash");
  });

  it("flags channel jargon, hashtags and emoji only where the channel bans them", () => {
    expect(brandViolations("our workflow is a bottleneck", "threads").map((v) => v.kind)).toEqual(["avoid-word", "avoid-word"]);
    expect(brandViolations("our workflow", "youtube")).toEqual([]);
    expect(brandViolations("nice #ai", "threads").map((v) => v.kind)).toContain("hashtag");
    expect(brandViolations("nice #ai", "instagram")).toEqual([]);
    expect(brandViolations("ship it \u{1F680}", "x").map((v) => v.kind)).toContain("emoji");
  });

  it("matches whole words only", () => {
    expect(brandViolations("an unlocking moment, seamlessness", "youtube")).toEqual([]);
  });
});

describe("hashtag policy", () => {
  it("is per channel", () => {
    expect(brandHashtagPolicy("youtube")).toEqual({ target: 4, max: 6, base: ["#shorts"] });
    expect(brandHashtagPolicy("instagram").target).toBe(8);
    expect(brandHashtagPolicy("threads")).toEqual({ target: 0, max: 0, base: [] });
  });
});
