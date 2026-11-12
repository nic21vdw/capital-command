import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET, PATCH, PUT } from "./route";
import { brandKitPath, saveBrandKitOverrides } from "@/lib/brand/kit";
import { clipProjectSchema } from "@/lib/storage/schemas";
import { captureVideoLook } from "@/lib/brand/video-look";

const look = captureVideoLook(clipProjectSchema.parse({ id: "test", jobId: "test", sourceFile: "clip.webm", createdAt: "test", updatedAt: "test" }), "one", "My look", "Keep the full story.");
const request = (body: unknown, method = "PATCH") => new Request("http://localhost:3100/api/brand-kit", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("guarded video look persistence", () => {
  it("persists and reloads a look in the existing kit while retaining other overrides", async () => {
    await saveBrandKitOverrides({ identity: { handle: "@retain" }, voice: { rules: ["Keep my voice."] } });
    const old = await (await GET()).json();
    const response = await PATCH(request({ videoLooks: [look], expectedOverrides: old.overrides }));
    expect(response.status).toBe(200);
    const reread = await (await GET()).json();
    expect(reread.kit.videoLooks).toEqual([look]);
    expect(reread.kit.identity.handle).toBe("@retain");
    expect(reread.kit.voice.rules).toEqual(["Keep my voice."]);
    expect(JSON.parse(readFileSync(brandKitPath(), "utf8")).videoLooks).toEqual([look]);
    expect((await PATCH(request({ videoLooks: [], expectedOverrides: reread.overrides }))).status).toBe(200);
    expect((await (await GET()).json()).kit.identity.handle).toBe("@retain");
  });

  it("rejects stale editor and Settings writes instead of dropping someone else's preferences", async () => {
    await saveBrandKitOverrides({});
    expect((await PATCH(request({ videoLooks: [look], expectedOverrides: {} }))).status).toBe(200);
    expect((await PATCH(request({ videoLooks: [], expectedOverrides: {} }))).status).toBe(409);
    expect((await PUT(request({ overrides: { identity: { handle: "@stale" } }, expectedOverrides: {} }, "PUT"))).status).toBe(409);
    expect((await (await GET()).json()).kit.videoLooks).toEqual([look]);
  });

  it("serializes simultaneous writes with only one successful expected revision", async () => {
    await saveBrandKitOverrides({});
    const results = await Promise.all([
      PATCH(request({ videoLooks: [look], expectedOverrides: {} })),
      PATCH(request({ videoLooks: [{ ...look, id: "two" }], expectedOverrides: {} }))
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it("leaves corrupt or invalid saved data byte-for-byte intact", async () => {
    await saveBrandKitOverrides({});
    for (const damaged of ["{ damaged", "null", "[]", JSON.stringify({ videoLooks: [{ id: "incomplete" }] })]) {
      writeFileSync(brandKitPath(), damaged);
      const response = await PATCH(request({ videoLooks: [look], expectedOverrides: {} }));
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain("saved brand kit");
      expect(readFileSync(brandKitPath(), "utf8")).toBe(damaged);
    }
    // Restore only this test's isolated temporary fixture for the next case.
    writeFileSync(brandKitPath(), "{}");
  });

  it("refuses invalid settings and missing concurrency snapshots", async () => {
    await saveBrandKitOverrides({});
    expect((await PATCH(request({ videoLooks: [look] }))).status).toBe(400);
    expect((await PATCH(request({ videoLooks: [{ ...look, name: "" }], expectedOverrides: {} }))).status).toBe(400);
    expect((await (await GET()).json()).kit.videoLooks).toEqual([]);
  });
});
