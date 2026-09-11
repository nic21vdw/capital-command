import { describe, expect, it } from "vitest";
import {
  APP_MESSAGE,
  HOST_MESSAGE,
  appResult,
  emptySurface,
  isSafeTokenValue,
  normalizeChrome,
  normalizeRoute,
  parseHostMessage,
  sanitizeThemeTokens
} from "./protocol";

describe("normalizeRoute", () => {
  it("adds the leading slash and drops a trailing one", () => {
    expect(normalizeRoute("clips")).toBe("/clips");
    expect(normalizeRoute("/clips/")).toBe("/clips");
    expect(normalizeRoute("/")).toBe("/");
  });

  it("falls back to home rather than leaving the app", () => {
    // A protocol-relative path is the one that matters: "//evil.example/x"
    // parses as a path but navigates to another origin entirely.
    expect(normalizeRoute("//evil.example/x")).toBe("/");
    expect(normalizeRoute("https://evil.example")).toBe("/");
    expect(normalizeRoute("/../../etc")).toBe("/");
    expect(normalizeRoute("/clips<script>")).toBe("/");
    expect(normalizeRoute(null)).toBe("/");
    expect(normalizeRoute(42)).toBe("/");
  });

  it("keeps pages but drops the query and hash", () => {
    expect(normalizeRoute("/master-calendar?week=3")).toBe("/master-calendar");
    expect(normalizeRoute("/clips#row-2")).toBe("/clips");
  });
});

describe("isSafeTokenValue", () => {
  it("accepts the colour forms a palette is written in", () => {
    expect(isSafeTokenValue("#0c1219")).toBe(true);
    expect(isSafeTokenValue("#fff")).toBe(true);
    expect(isSafeTokenValue("rgba(255, 255, 255, 0.075)")).toBe(true);
    expect(isSafeTokenValue("hsl(210 80% 50%)")).toBe(true);
    expect(isSafeTokenValue("transparent")).toBe(true);
  });

  it("refuses anything that could close a declaration or fetch", () => {
    expect(isSafeTokenValue("red; background: url(http://x)")).toBe(false);
    expect(isSafeTokenValue("url(http://evil.example/pixel.png)")).toBe(false);
    expect(isSafeTokenValue("}html{display:none")).toBe(false);
    expect(isSafeTokenValue("/* */ red")).toBe(false);
    expect(isSafeTokenValue("#".padEnd(80, "a"))).toBe(false);
    expect(isSafeTokenValue("")).toBe(false);
  });
});

describe("sanitizeThemeTokens", () => {
  it("keeps allowlisted names and drops everything else", () => {
    const tokens = sanitizeThemeTokens({
      "--accent": "#4da6ff",
      "--background": "#070c12",
      "--not-a-token": "#ff0000",
      "--accent-strong": "url(http://evil.example)"
    });
    expect(tokens).toEqual({ "--accent": "#4da6ff", "--background": "#070c12" });
  });

  it("is empty for anything that is not an object", () => {
    expect(sanitizeThemeTokens(null)).toEqual({});
    expect(sanitizeThemeTokens(["--accent", "#fff"])).toEqual({});
  });
});

describe("normalizeChrome", () => {
  it("takes the three modes and nothing else", () => {
    expect(normalizeChrome("bare")).toBe("bare");
    expect(normalizeChrome("COMPACT")).toBe("compact");
    expect(normalizeChrome("enormous")).toBe("full");
    expect(normalizeChrome(undefined, "compact")).toBe("compact");
  });
});

describe("parseHostMessage", () => {
  it("ignores anything that is not a host message", () => {
    expect(parseHostMessage(null)).toBeNull();
    expect(parseHostMessage("colateral:navigate")).toBeNull();
    expect(parseHostMessage({ type: "webpack-hmr" })).toBeNull();
    expect(parseHostMessage({ type: "capital-command:ready" })).toBeNull();
  });

  it("normalizes a navigate", () => {
    const request = parseHostMessage({ type: HOST_MESSAGE.navigate, id: "r1", route: "clips/" });
    expect(request?.type).toBe(HOST_MESSAGE.navigate);
    expect(request?.id).toBe("r1");
    expect(request?.route).toBe("/clips");
  });

  it("takes fields as an object or as a list of pairs", () => {
    const asObject = parseHostMessage({ type: HOST_MESSAGE.setFields, fields: { title: "Hello", count: 3 } });
    expect(asObject?.fields).toEqual({ title: "Hello", count: 3 });

    const asList = parseHostMessage({
      type: HOST_MESSAGE.setFields,
      fields: [
        { field: "title", value: "Hello" },
        { field: "live", value: true }
      ]
    });
    expect(asList?.fields).toEqual({ title: "Hello", live: true });
  });

  it("accepts `inputs` as an alias, which is what the canvas tool calls it", () => {
    const request = parseHostMessage({ type: HOST_MESSAGE.setFields, inputs: { title: "Hi" } });
    expect(request?.fields).toEqual({ title: "Hi" });
  });

  it("drops a value it cannot carry rather than passing an object through", () => {
    const request = parseHostMessage({
      type: HOST_MESSAGE.setFields,
      fields: { nested: { a: 1 }, broken: Number.NaN, fine: "ok" }
    });
    expect(request?.fields).toEqual({ nested: null, broken: null, fine: "ok" });
  });

  it("tells a message that never mentioned chrome from one that asked for full", () => {
    expect(parseHostMessage({ type: HOST_MESSAGE.hello })?.chrome).toBe("");
    expect(parseHostMessage({ type: HOST_MESSAGE.hello, chrome: "full" })?.chrome).toBe("full");
  });
});

describe("appResult", () => {
  it("is addressed and typed", () => {
    const result = appResult("r1", true, { applied: ["Title"] });
    expect(result).toEqual({ type: APP_MESSAGE.result, id: "r1", ok: true, applied: ["Title"] });
  });
});

describe("emptySurface", () => {
  it("still names the page it could not read", () => {
    expect(emptySurface("/clips", "Short Clips")).toEqual({
      route: "/clips",
      title: "Short Clips",
      fields: [],
      controls: [],
      readings: []
    });
  });
});
