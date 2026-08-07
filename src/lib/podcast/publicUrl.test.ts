import { describe, expect, it } from "vitest";
import { applyEnvValue, checkPublicBaseUrl, PUBLIC_BASE_URL_KEY } from "@/lib/podcast/publicUrl";

function problem(raw: string): string {
  const result = checkPublicBaseUrl(raw);
  if (result.ok) throw new Error(`Expected "${raw}" to be rejected, got ${result.url}`);
  return result.problem;
}

function accepted(raw: string): string {
  const result = checkPublicBaseUrl(raw);
  if (!result.ok) throw new Error(`Expected "${raw}" to be accepted, got: ${result.problem}`);
  return result.url;
}

describe("checkPublicBaseUrl", () => {
  it("accepts an R2 public development URL", () => {
    expect(accepted("https://pub-3f9c21.r2.dev")).toBe("https://pub-3f9c21.r2.dev");
  });

  it("assumes https for a bare host, because that is how the address is pasted", () => {
    expect(accepted("pub-3f9c21.r2.dev")).toBe("https://pub-3f9c21.r2.dev");
  });

  it("keeps a custom domain's subfolder but drops the trailing slash", () => {
    expect(accepted("https://media.example.com/podcast/")).toBe("https://media.example.com/podcast");
  });

  it("trims surrounding whitespace from a paste", () => {
    expect(accepted("  https://media.example.com  ")).toBe("https://media.example.com");
  });

  it("asks for an address when given nothing", () => {
    expect(problem("   ")).toContain("Paste");
  });

  it("rejects http, which Spotify will not fetch episode files over", () => {
    expect(problem("http://media.example.com")).toContain("https");
  });

  it("rejects credentials, which would end up in a public feed", () => {
    expect(problem("https://someone:hunter2@media.example.com")).toContain("username and password");
  });

  it("rejects a link to one file rather than a base address", () => {
    expect(problem("https://media.example.com/feed.xml?token=abc")).toContain("?");
  });

  it("rejects localhost and other addresses only this machine can reach", () => {
    expect(problem("https://localhost:3000")).toContain("only reachable from this machine");
    expect(problem("https://192.168.1.40")).toContain("only reachable from this machine");
    expect(problem("https://nas.local")).toContain("only reachable from this machine");
    expect(problem("https://bucket")).toContain("only reachable from this machine");
  });

  it("rejects something that is not an address at all", () => {
    expect(problem("https://")).toContain("not a web address");
  });
});

describe("applyEnvValue", () => {
  const url = "https://pub-3f9c21.r2.dev";

  it("fills in an existing empty assignment and leaves every other line alone", () => {
    const before = ["S3_BUCKET=clips", "# Optional: public bucket URL.", "S3_PUBLIC_BASE_URL=", "OPENAI_API_KEY=sk-secret", ""].join("\n");
    expect(applyEnvValue(before, PUBLIC_BASE_URL_KEY, url)).toBe(
      ["S3_BUCKET=clips", "# Optional: public bucket URL.", `S3_PUBLIC_BASE_URL=${url}`, "OPENAI_API_KEY=sk-secret", ""].join("\n")
    );
  });

  it("replaces a value that was already set", () => {
    const before = `S3_PUBLIC_BASE_URL=https://old.example.com\nS3_REGION=auto\n`;
    expect(applyEnvValue(before, PUBLIC_BASE_URL_KEY, url)).toBe(`S3_PUBLIC_BASE_URL=${url}\nS3_REGION=auto\n`);
  });

  it("preserves CRLF line endings and a byte-order mark", () => {
    const before = "\ufeffS3_BUCKET=clips\r\nS3_PUBLIC_BASE_URL=\r\n";
    expect(applyEnvValue(before, PUBLIC_BASE_URL_KEY, url)).toBe(`\ufeffS3_BUCKET=clips\r\nS3_PUBLIC_BASE_URL=${url}\r\n`);
  });

  it("keeps the indentation and export prefix of the line it rewrites", () => {
    expect(applyEnvValue("  export S3_PUBLIC_BASE_URL=old\n", PUBLIC_BASE_URL_KEY, url)).toBe(
      `  export S3_PUBLIC_BASE_URL=${url}\n`
    );
  });

  it("leaves a commented-out line commented and appends the real one", () => {
    const before = "# S3_PUBLIC_BASE_URL=https://example.invalid\nS3_REGION=auto\n";
    expect(applyEnvValue(before, PUBLIC_BASE_URL_KEY, url)).toBe(
      `# S3_PUBLIC_BASE_URL=https://example.invalid\nS3_REGION=auto\nS3_PUBLIC_BASE_URL=${url}\n`
    );
  });

  it("appends to a file that has no trailing newline", () => {
    expect(applyEnvValue("S3_REGION=auto", PUBLIC_BASE_URL_KEY, url)).toBe(`S3_REGION=auto\nS3_PUBLIC_BASE_URL=${url}`);
  });

  it("writes the one line into an empty file", () => {
    expect(applyEnvValue("", PUBLIC_BASE_URL_KEY, url)).toBe(`S3_PUBLIC_BASE_URL=${url}\n`);
  });
});
