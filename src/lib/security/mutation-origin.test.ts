import { describe, expect, it } from "vitest";
import { mutationOriginAllowed } from "./mutation-origin";

const target = "http://127.0.0.1:3000/api/update";
const request = (headers: Record<string, string>, url = target) => new Request(url, { method: "POST", headers });

describe("local browser mutation boundary", () => {
  it.each([
    { host: "localhost:3000", origin: "https://attacker.invalid" },
    { host: "localhost:3000", origin: "null" },
    { host: "localhost:3000", origin: "http://localhost:3000/path" },
    { host: "localhost:3000", origin: "http://user@localhost:3000" },
    { host: "localhost:3000", origin: "http://localhost:3100" },
    { host: "localhost:3000", "sec-fetch-site": "cross-site" },
    { host: "localhost:3000", "sec-fetch-site": "same-site" },
    { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "cross-site" },
    { host: "attacker.invalid:3000", origin: "http://attacker.invalid:3000", "x-forwarded-host": "localhost:3000" },
    { host: "localhost:3000/path", origin: "http://localhost:3000" }
  ])("rejects hostile browser authority %j", (headers) => {
    expect(mutationOriginAllowed(request(headers as Record<string, string>))).toBe(false);
  });

  it("rejects same-origin DNS rebinding even when URL and Host agree", () => {
    expect(mutationOriginAllowed(request({ host: "attacker.invalid:3000", origin: "http://attacker.invalid:3000" }, "http://attacker.invalid:3000/api/update"))).toBe(false);
  });

  it.each([
    { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
    { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe" },
    { host: "[::1]:3000", origin: "http://[::1]:3000", "sec-fetch-site": "same-origin" },
    { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    { host: "localhost:3000" },
    {}
  ])("preserves local browser aliases and CLI %j", (headers) => {
    expect(mutationOriginAllowed(request(headers as Record<string, string>))).toBe(true);
  });
});
