import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { externalizeAllOverlays, externalizeProjectOverlays, storeOverlayImage } from "@/lib/clipping/overlay-images";
import type { ClipProject } from "@/types/domain";

/**
 * Inline overlay pictures are what made the app-data file 12 MB and the
 * dashboard unclickable, so the important assertions here are that nothing
 * inline survives a save and that the same picture is stored once.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "overlay-images-"));
  vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", dir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const PNG = `data:image/png;base64,${Buffer.from("pretend-png-bytes").toString("base64")}`;
const OTHER = `data:image/png;base64,${Buffer.from("a-different-picture").toString("base64")}`;

function overlay(overrides: Record<string, unknown> = {}) {
  return {
    id: `o-${Math.random()}`,
    kind: "watermark",
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    opacity: 1,
    z: 0,
    locked: false,
    start: 0,
    end: 0,
    ...overrides
  };
}

function project(overlays: unknown[]): ClipProject {
  return { id: "clip-1", name: "Clip 1", overlays } as unknown as ClipProject;
}

describe("storeOverlayImage", () => {
  it("writes the bytes to disk and hands back a URL to reach them", async () => {
    const url = await storeOverlayImage(PNG);

    expect(url).toMatch(/^\/api\/clips\/overlay-images\/[0-9a-f]{40}\.png$/);
    const file = url.split("/").pop()!;
    expect(await readFile(path.join(dir, "overlay-images", file), "utf8")).toBe("pretend-png-bytes");
  });

  it("stores one file per picture, however many clips use it", async () => {
    const first = await storeOverlayImage(PNG);
    const second = await storeOverlayImage(PNG);

    expect(second).toBe(first);
    expect(await readdir(path.join(dir, "overlay-images"))).toHaveLength(1);
  });

  it("leaves anything that is not a data URL alone", async () => {
    expect(await storeOverlayImage("/api/clips/overlay-images/abc.png")).toBe("/api/clips/overlay-images/abc.png");
  });
});

describe("externalizeProjectOverlays", () => {
  it("moves every inline picture out and keeps the rest of the overlay", async () => {
    const moved = await externalizeProjectOverlays(
      project([overlay({ src: PNG, opacity: 0.4 }), overlay({ kind: "text", text: "hello" })])
    );

    expect(moved.overlays[0].src).toMatch(/^\/api\/clips\/overlay-images\//);
    expect(moved.overlays[0].opacity).toBe(0.4);
    expect(moved.overlays[1].text).toBe("hello");
    expect(JSON.stringify(moved)).not.toContain("data:image");
  });

  it("returns the project untouched when there is nothing inline", async () => {
    const original = project([overlay({ src: "/api/clips/overlay-images/abc.png" })]);
    expect(await externalizeProjectOverlays(original)).toBe(original);
  });

  it("copes with a project that has no overlays at all", async () => {
    const bare = { id: "clip-2", name: "Bare" } as unknown as ClipProject;
    expect(await externalizeProjectOverlays(bare)).toBe(bare);
  });
});

describe("externalizeAllOverlays", () => {
  it("reports whether anything moved, so a read only writes when it must", async () => {
    const untouched = await externalizeAllOverlays([project([overlay({ kind: "text", text: "hi" })])]);
    expect(untouched.changed).toBe(false);

    const repaired = await externalizeAllOverlays([project([overlay({ src: PNG })]), project([overlay({ src: OTHER })])]);
    expect(repaired.changed).toBe(true);
    expect(JSON.stringify(repaired.projects)).not.toContain("data:image");
    expect(await readdir(path.join(dir, "overlay-images"))).toHaveLength(2);
  });
});
