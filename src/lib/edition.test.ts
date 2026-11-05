import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITION, isPublicEdition, isRouteShipped } from "@/lib/edition";
import { OWNER_BRAND_KIT, PUBLIC_BRAND_KIT, channelContext } from "@/lib/brand/defaults";
import { OWNER_IDENTITY as PUBLIC_IDENTITY } from "@/lib/brand/owner-identity.public";
import { promptBlockFor } from "@/lib/brand/rules";
import { BRAND_CHANNELS } from "@/lib/brand/defaults";
import {
  LEAK_TERMS,
  auditPackage,
  findLeaks,
  isOwnerOnly,
  trimPackageScripts
} from "../../scripts/marketing-package.mjs";

const leaks = (text: string) => LEAK_TERMS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);

describe("the edition this checkout builds", () => {
  it("is the owner's, so nothing changes for the running app", () => {
    expect(EDITION).toBe("owner");
    expect(isPublicEdition()).toBe(false);
    expect(isRouteShipped("/finance")).toBe(true);
  });
});

describe("the public edition", () => {
  it("ships no personal finance screen and no Segment Deck", () => {
    for (const path of ["/finance", "/holdings", "/watchlist", "/goals", "/presentation", "/finance/"]) {
      expect(isRouteShipped(path, "public")).toBe(false);
    }
    for (const path of ["/", "/clips", "/carousels", "/uploading-center", "/settings"]) {
      expect(isRouteShipped(path, "public")).toBe(true);
    }
  });

  it("writes as the buyer, never as the owner", () => {
    const kit = JSON.stringify(PUBLIC_BRAND_KIT);
    expect(leaks(kit)).toEqual([]);
    expect(kit).not.toMatch(/\bNic\b|colateralai\.com|structural/i);
    expect(PUBLIC_BRAND_KIT.products).toEqual([]);
    expect(PUBLIC_BRAND_KIT.carousel.signature).toEqual({ name: "", handle: "" });
    for (const channel of BRAND_CHANNELS) {
      expect(PUBLIC_BRAND_KIT.channels[channel].cta).toEqual({ line: "", url: "" });
      const block = promptBlockFor(PUBLIC_BRAND_KIT, channel);
      expect(block).not.toMatch(/CoLateral|\bNic\b|Products you may name/);
    }
    expect(channelContext(PUBLIC_BRAND_KIT)).not.toMatch(/The creator is/);
  });

  it("swaps in an identity that names nobody", () => {
    expect(leaks(JSON.stringify(PUBLIC_IDENTITY))).toEqual([]);
    expect(PUBLIC_IDENTITY.alreadyOnYoutubeSeries).toEqual([]);
    expect(OWNER_BRAND_KIT.identity.firstName).toBe("Nic");
  });
});

describe("the packager", () => {
  it("leaves the owner's files and the finance screens out", () => {
    expect(isOwnerOnly("src/app/finance/page.tsx")).toBe(true);
    expect(isOwnerOnly("src/app/api/market/quote/route.ts")).toBe(true);
    expect(isOwnerOnly("src/lib/brand/kit.test.ts")).toBe(true);
    expect(isOwnerOnly("CHANGELOG.md")).toBe(true);
    expect(isOwnerOnly("src/components/finance/theme-picker.tsx")).toBe(false);
    expect(isOwnerOnly("src/app/clips/page.tsx")).toBe(false);
  });

  it("names a leak by file and line", () => {
    expect(findLeaks("a.ts", "ok\nconst x = 'Wealthsimple TFSA';")).toEqual([
      { file: "a.ts", line: 2, kind: "identity", match: "wealthsimple" }
    ]);
    expect(findLeaks("b.ts", `const key = "sk-ant-${"a".repeat(30)}";`)[0]?.kind).toBe("secret");
    expect(findLeaks("c.ts", "const site = 'https://example.com';")).toEqual([]);
  });

  it("refuses a staged folder carrying data, keys or the owner edition", () => {
    const root = mkdtempSync(join(tmpdir(), "marketing-package-"));
    mkdirSync(join(root, "data"));
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    writeFileSync(join(root, "data", "publish-queue.json"), "[]");
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=x");
    writeFileSync(join(root, "src", "lib", "edition.ts"), 'export const EDITION = "owner" as Edition;');
    const kinds = auditPackage(root).map((problem: { kind: string }) => problem.kind).sort();
    expect(kinds).toEqual(["data", "edition", "secret"]);
  });

  it("drops npm scripts whose file did not ship", () => {
    const root = mkdtempSync(join(tmpdir(), "marketing-scripts-"));
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts", "build-app.mjs"), "");
    const pkg = trimPackageScripts(
      {
        name: "x",
        scripts: {
          build: "node scripts/build-app.mjs --turbopack",
          start: "next start --hostname 127.0.0.1 --port 3000",
          "app:update": "powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\update-app.ps1",
          "backup:state": "tsx scripts/backup-state.ts"
        }
      },
      root
    );
    expect(Object.keys(pkg.scripts)).toEqual(["build", "start"]);
    expect(pkg.name).toBe("colateral-marketing");
  });
});
