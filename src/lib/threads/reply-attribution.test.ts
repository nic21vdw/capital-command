import { describe, expect, it } from "vitest";
import {
  threadsReplyUrl,
  THREADS_REPLY_URL_MAX_LENGTH,
} from "@/lib/threads/reply-attribution";

const context = { angle: "custom-tools", origin: "autopilot" } as const;

describe("Threads reply conversion links", () => {
  it.each([
    "https://colateralai.com",
    "https://colateralai.com/",
    "https://www.colateralai.com/",
  ])(
    "attributes the bare homepage %s through the existing Threads route",
    (raw) => {
      const result = new URL(threadsReplyUrl(raw, context)!);
      expect(result.pathname).toBe("/th");
      expect(result.searchParams.get("utm_source")).toBe("threads");
      expect(result.searchParams.get("utm_medium")).toBe("social");
      expect(result.searchParams.get("utm_campaign")).toBe(
        "colateral-exposure",
      );
      expect(result.searchParams.get("utm_content")).toBe(
        "autopilot-custom-tools",
      );
    },
  );

  it("preserves a configured destination, query encoding and fragment", () => {
    const raw =
      "https://colateralai.com/modules?ref=a%20b&choice=%2f#engineering";
    const result = threadsReplyUrl(raw, {
      angle: "engineering",
      origin: "pipeline",
    })!;
    expect(result).toContain(
      "https://colateralai.com/modules?ref=a%20b&choice=%2f&",
    );
    expect(result).toMatch(/#engineering$/);
    expect(new URL(result).searchParams.get("utm_content")).toBe(
      "pipeline-engineering",
    );
  });

  it("preserves query and fragment on the homepage while adding the Threads route", () => {
    const result = threadsReplyUrl(
      "https://colateralai.com/?ref=launch#demo",
      context,
    )!;
    expect(result).toContain("https://colateralai.com/th?ref=launch&");
    expect(result).toMatch(/#demo$/);
  });

  it("never overrides existing UTM tags, including empty and differently cased keys", () => {
    const raw =
      "https://colateralai.com/th?UTM_SOURCE=partner&utm_medium=&utm_campaign=old&utm_content=chosen#watch";
    expect(threadsReplyUrl(raw, context)).toBe(raw);
  });

  it("fills only missing UTM tags without re-encoding caller parameters", () => {
    const result = threadsReplyUrl(
      "https://colateralai.com/download?utm_source=nic&ref=A%2FB",
      context,
    )!;
    expect(result).toContain("?utm_source=nic&ref=A%2FB&utm_medium=social&");
    expect(new URL(result).searchParams.getAll("utm_source")).toEqual(["nic"]);
  });

  it("is idempotent even if called later with a different angle or origin", () => {
    const result = threadsReplyUrl("https://colateralai.com", context)!;
    expect(threadsReplyUrl(result, context)).toBe(result);
    expect(
      threadsReplyUrl(result, { angle: "another", origin: "pipeline" }),
    ).toBe(result);
  });

  it.each(["colateralai.com", "custom.example"])(
    "never exposes configured query credentials on %s",
    (host) => {
      for (const key of [
        "access_token",
        "refresh_token",
        "token",
        "secret",
        "key",
        "api_key",
        "ACCESS_TOKEN",
        "%61cc%65ss_token",
        "%41PI_KEY",
      ]) {
        expect(
          threadsReplyUrl(`https://${host}/tools?${key}=private`, context),
        ).toBeUndefined();
      }
    },
  );

  it("preserves harmless query values, similar keys and existing UTM tags", () => {
    const query =
      "keyword=api_key&description=access_token%3Dtest&token_count=3&monkey=banana&utm_content=secret";
    const custom = `https://custom.example/tools?${query}`;
    expect(threadsReplyUrl(custom, context)).toBe(custom);
    const own = threadsReplyUrl(
      `https://colateralai.com/tools?${query}`,
      context,
    )!;
    expect(own).toContain(`?${query}&`);
    expect(new URL(own).searchParams.get("utm_content")).toBe("secret");
  });

  it("tracks only editorial angles, never raw identifiers or injected values", () => {
    const result = threadsReplyUrl("https://colateralai.com/pricing", {
      angle: " CUSTOM-TOOLS ",
    })!;
    expect(new URL(result).searchParams.get("utm_content")).toBe(
      "autopilot-custom-tools",
    );
    for (const angle of [
      "",
      "post-18497498094",
      "account-nic-private",
      "build&userId=secret",
      "a".repeat(500),
    ]) {
      const result = threadsReplyUrl("https://colateralai.com", { angle })!;
      expect(new URL(result).searchParams.get("utm_content")).toBe(
        "autopilot-general",
      );
      expect(result).not.toContain(angle === "" ? "undefined" : angle);
    }
  });

  it.each([
    "https://example.com/tools?utm_source=custom#start",
    "http://example.com:8080/Build%20Tools?q=1",
    "https://notcolateralai.com",
    "https://colateralai.com.evil.example/",
    "https://colateralai.com.evil.example/?utm_content=keep",
    "https://docs.colateralai.com",
    "https://colateralai.com./",
    "https://evil.example/?next=https://colateralai.com",
  ])(
    "preserves external destinations and lookalike domains without CoLateral tracking: %s",
    (raw) => {
      expect(threadsReplyUrl(raw, context)).toBe(raw);
    },
  );

  it.each([
    "",
    "colateralai.com",
    "ftp://colateralai.com",
    "javascript:alert(1)",
    "https://",
    "https:///",
    "https:///colateralai.com",
    "https://@colateralai.com",
    "https://:@colateralai.com",
    "https://nic:secret@colateralai.com",
    "https://colateralai.com@evil.example/",
    "https://colateralai.com/\nhttps://evil.example",
    " https://colateralai.com",
    "https://colateralai.com/ ",
    "https://colateralai.com/\u200b",
    "https://colateralai.com/%0aFake",
    "https://colateralai.com/?q=%0Dtest",
    "https://colateralai.com/\u00ad",
    "https://colateralai.com/%ZZ",
    "https://colateralai.com/?discount=50%",
    "https://colateralai.com\\@evil.example/",
  ])("rejects invalid or injected destinations: %s", (raw) => {
    expect(threadsReplyUrl(raw, context)).toBeUndefined();
  });

  it("omits URLs that cannot fit with attribution rather than truncating them", () => {
    const raw = `https://colateralai.com/${"a".repeat(250)}`;
    expect(raw.length).toBeLessThan(THREADS_REPLY_URL_MAX_LENGTH);
    expect(threadsReplyUrl(raw, context)).toBeUndefined();
    expect(
      threadsReplyUrl(
        `https://example.com/${"a".repeat(THREADS_REPLY_URL_MAX_LENGTH)}`,
        context,
      ),
    ).toBeUndefined();
  });

  it("preserves exact-cap custom URLs and existing trailing query separators", () => {
    const base = "https://example.com/";
    const exactCap = `${base}${"a".repeat(THREADS_REPLY_URL_MAX_LENGTH - base.length)}`;
    expect(threadsReplyUrl(exactCap, context)).toBe(exactCap);
    const result = threadsReplyUrl(
      "https://colateralai.com/tools?ref=one&",
      context,
    )!;
    expect(result).toContain("?ref=one&utm_source=threads&");
  });
});
