import { describe, expect, it } from "vitest";
import { describeOAuthLanding } from "./oauthLanding";

const parse = (query: string) => describeOAuthLanding(new URLSearchParams(query));

describe("describeOAuthLanding", () => {
  it("says nothing on an ordinary visit", () => {
    expect(parse("")).toBeNull();
    expect(parse("tab=youtube")).toBeNull();
  });

  it("reports a connected platform as a success", () => {
    expect(parse("connected=youtube")).toMatchObject({ tone: "success", platform: "youtube", title: "YouTube connected" });
  });

  it("counts the uploads a reconnect retried", () => {
    expect(parse("connected=youtube&recovered=2")?.detail).toBe("2 blocked uploads retried automatically.");
  });

  it("explains a denied sign-in in plain words, not the provider code", () => {
    const landing = parse("connect_error=access_denied&connect=youtube");
    expect(landing?.tone).toBe("error");
    expect(landing?.title).toBe("YouTube did not connect");
    expect(landing?.detail).toMatch(/cancelled, or access was not granted/);
    expect(landing?.raw).toBe("access_denied");
  });

  it("still reports a failure that names no known platform", () => {
    expect(parse("connect_error=access_denied&connect=nope")).toMatchObject({ tone: "error", platform: null });
  });
});
