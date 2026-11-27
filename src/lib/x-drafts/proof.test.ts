import { describe, expect, it, vi } from "vitest";
import { preparePrivateProofDraft, writeDraftBatch } from "./generator";

vi.mock("@/lib/ai", () => ({ runAi: async () => ({ text: '{"drafts":[]}' }) }));
vi.mock("@/lib/publisher/adapters/youtube", () => ({ youtubeAccessToken: async () => "mock" }));
vi.mock("@/lib/youtube/quotaSpend", () => ({ debitOrSkip: async () => undefined }));
vi.mock("@/lib/publisher/http", () => ({ fetchJson: vi.fn() }));

const id = "i917Bz5WGzA";
const url = "https://www.youtube.com/live/" + id + "?t=1m36s";
const text = "CoLateral Arcade surprised me in the demo. Seeing a character on screen is not the same as finishing a round. Which would you test first?";
const input = { url, text, recentOpenings: [] };
const item = { id, status: { privacyStatus: "public", uploadStatus: "processed" } };

describe("private X proof preview", () => {
  it("requires matching authoritative visibility and preserves exact link outside the bookable draft shape", async () => {
    const read = vi.fn(async () => ({ items: [item] }));
    const result = await preparePrivateProofDraft(input, read);
    expect(read).toHaveBeenCalledWith(id);
    expect(result).toEqual({ disposition: "private-preview-only", text, reply: "See the stream: " + url });
    expect(result).not.toHaveProperty("status");
    expect(await writeDraftBatch({ date: "2026-11-26", times: ["19:00"], now: new Date(), recentOpenings: [] })).toEqual({ drafts: [], dropped: [] });
  });

  it("rejects unlisted, unprocessed, mismatched and failed lookups", async () => {
    for (const fake of [{ ...item, status: { ...item.status, privacyStatus: "unlisted" } }, { ...item, status: { ...item.status, uploadStatus: "uploaded" } }, { ...item, id: "abcdefghijk" }]) {
      expect(await preparePrivateProofDraft(input, async () => ({ items: [fake] }))).toBeNull();
    }
    expect(await preparePrivateProofDraft(input, async () => { throw new Error("offline"); })).toBeNull();
  });

  it("rejects lookalikes, duplicates and unsupported clip URLs without looking them up", async () => {
    const read = vi.fn(async () => ({ items: [item] }));
    for (const bad of ["https://www.youtube.com.evil.test/live/" + id, "https://www.youtube.com/clip/" + id, url + "\n"]) {
      expect(await preparePrivateProofDraft({ ...input, url: bad }, read)).toBeNull();
    }
    expect(await preparePrivateProofDraft({ ...input, recentOpenings: [text] }, read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
