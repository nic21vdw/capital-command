import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRAND_KIT } from "./defaults";

const reply = (overrides = {}, status = 200) => new Response(JSON.stringify({ kit: DEFAULT_BRAND_KIT, overrides, issues: [] }), { status });
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("brand-kit client write guards", () => {
  it("cannot save defaults after an initial read failure", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const client = await import("./client");
    await client.loadBrandKit();
    expect(await client.saveBrandKit({})).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("allows correcting an invalid Settings draft after a rejected save", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ identity: { handle: "@kept" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Invalid name" }), { status: 400 }))
      .mockResolvedValueOnce(reply({ identity: { handle: "@corrected" } }));
    vi.stubGlobal("fetch", fetch);
    const client = await import("./client");
    await client.loadBrandKit();
    expect(await client.saveBrandKit({ identity: { name: "" } })).toBe(false);
    expect(await client.saveBrandKit({ identity: { handle: "@corrected" } })).toBe(true);
    expect(JSON.parse(fetch.mock.calls[2][1].body).expectedOverrides).toEqual({ identity: { handle: "@kept" } });
  });

  it("does not let an older read replace the newer expected revision", async () => {
    let finishOld!: (response: Response) => void;
    const fetch = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(reply({ identity: { handle: "@latest" } })).mockResolvedValueOnce(reply());
    vi.stubGlobal("fetch", fetch);
    const client = await import("./client");
    const old = client.loadBrandKit();
    await client.loadBrandKit(true);
    finishOld(reply({ identity: { handle: "@old" } }));
    await old;
    expect(await client.saveVideoLooks([])).toBe(true);
    expect(JSON.parse(fetch.mock.calls[2][1].body).expectedOverrides).toEqual({ identity: { handle: "@latest" } });
  });

  it("blocks saves after a failed refresh even when a cached kit is displayed", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply()).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const client = await import("./client");
    await client.loadBrandKit();
    await client.loadBrandKit(true);
    expect(await client.saveVideoLooks([])).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
