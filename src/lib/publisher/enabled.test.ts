import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the FILE is redirected — `applyEnvValue` is the real one, because
// preserving every other line of a `.env` is the whole risk of this module and
// a reimplementation in the test would prove nothing.
const fixture = { file: "" };
vi.mock("@/lib/podcast/publicUrl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/podcast/publicUrl")>()),
  envFilePath: () => fixture.file
}));

const { PUBLISHING_OFF_MESSAGE, bookingBlockers, publishingEnabled, setPublishingEnabled } = await import(
  "@/lib/publisher/enabled"
);

beforeEach(async () => {
  fixture.file = path.join(await mkdtemp(path.join(tmpdir(), "cc-env-")), ".env");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("setPublishingEnabled", () => {
  it("writes the flag and leaves every other line alone", async () => {
    const before = ["# publishing", "PUBLISH_ENABLED=false", "YOUTUBE_REFRESH_TOKEN=keep-me", "", "OTHER=keep"].join("\r\n");
    await writeFile(fixture.file, before, "utf8");

    await setPublishingEnabled(true);

    const after = await readFile(fixture.file, "utf8");
    expect(after).toContain("PUBLISH_ENABLED=true");
    expect(after).not.toContain("PUBLISH_ENABLED=false");
    expect(after).toContain("# publishing");
    expect(after).toContain("YOUTUBE_REFRESH_TOKEN=keep-me");
    expect(after).toContain("OTHER=keep");
  });

  it("adds the flag to a file that never had it", async () => {
    await writeFile(fixture.file, "OTHER=keep\n", "utf8");
    await setPublishingEnabled(true);
    const after = await readFile(fixture.file, "utf8");
    expect(after).toContain("OTHER=keep");
    expect(after).toContain("PUBLISH_ENABLED=true");
  });

  it("writes a fresh file when there is no .env at all", async () => {
    await setPublishingEnabled(false);
    expect(await readFile(fixture.file, "utf8")).toContain("PUBLISH_ENABLED=false");
  });

  it("takes effect with nothing restarted", async () => {
    await setPublishingEnabled(true);
    expect(process.env.PUBLISH_ENABLED).toBe("true");
    expect(publishingEnabled()).toBe(true);

    await setPublishingEnabled(false);
    expect(process.env.PUBLISH_ENABLED).toBe("false");
    expect(publishingEnabled()).toBe(false);
  });
});

describe("publishingEnabled", () => {
  it("is off until something switches it on", () => {
    vi.stubEnv("PUBLISH_ENABLED", "");
    expect(publishingEnabled()).toBe(false);
  });

  it("reads the flag the way the rest of the publisher does", () => {
    vi.stubEnv("PUBLISH_ENABLED", "yes");
    expect(publishingEnabled()).toBe(true);
  });
});

describe("bookingBlockers", () => {
  it("says nothing when a run could book", () => {
    vi.stubEnv("PUBLISH_ENABLED", "true");
    vi.stubEnv("PUBLISH_PLATFORMS", "youtube");
    expect(bookingBlockers()).toEqual([]);
  });

  it("leads with publishing being off, not the empty platform list", () => {
    vi.stubEnv("PUBLISH_ENABLED", "false");
    vi.stubEnv("PUBLISH_PLATFORMS", "none");
    expect(bookingBlockers()).toHaveLength(1);
    expect(bookingBlockers()[0]).toContain("Publishing is switched off");
  });

  it("names the missing platforms once publishing is on", () => {
    vi.stubEnv("PUBLISH_ENABLED", "true");
    vi.stubEnv("PUBLISH_PLATFORMS", "none");
    expect(bookingBlockers()).toEqual(["No platforms are switched on, so nothing has anywhere to go."]);
  });
});

describe("the one sentence every screen says", () => {
  it("points at Settings and mentions no file or restart", () => {
    expect(PUBLISHING_OFF_MESSAGE).toContain("Settings");
    expect(PUBLISHING_OFF_MESSAGE).not.toMatch(/\.env|restart|PUBLISH_ENABLED/);
  });
});
