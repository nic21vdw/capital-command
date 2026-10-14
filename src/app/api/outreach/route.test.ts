import { writeFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { dataPath } from "@/lib/paths";
import { readOutreachStore } from "@/lib/outreach/store";
import { POST as importContacts } from "./import/route";
import { DELETE, GET, PATCH, POST } from "./route";

function request(method: string, body?: unknown, query = "") {
  return new NextRequest(`http://localhost:3000/api/outreach${query}`, {
    method,
    headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

describe("/api/outreach", () => {
  it("adds, moves, edits, clears and removes a contact", async () => {
    const added = await (await POST(request("POST", { contact: { name: "Agent Dev", url: "https://youtube.com/@agentdev" } }))).json();
    expect(added.added).toBe(true);
    const id = added.contacts[0].id as string;

    const moved = await (await PATCH(request("PATCH", { id, status: "contacted" }))).json();
    expect(moved.contacts[0].status).toBe("contacted");
    expect(moved.contacts[0].nextFollowUpAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const edited = await (await PATCH(request("PATCH", { id, patch: { notes: "Keen", affiliateCode: "AGENTDEV" } }))).json();
    expect(edited.contacts[0]).toMatchObject({ notes: "Keen", affiliateCode: "AGENTDEV", status: "contacted" });

    const cleared = await (await PATCH(request("PATCH", { id, patch: { nextFollowUpAt: null, affiliateCode: "" } }))).json();
    expect(cleared.contacts[0].nextFollowUpAt).toBeUndefined();
    expect(cleared.contacts[0].affiliateCode).toBeUndefined();
    expect(cleared.contacts[0].notes).toBe("Keen");

    expect((await PATCH(request("PATCH", { id: "missing", status: "deal" }))).status).toBe(404);
    expect((await PATCH(request("PATCH", { id, status: "maybe" }))).status).toBe(400);

    const removed = await (await DELETE(request("DELETE", undefined, `?id=${id}`))).json();
    expect(removed.contacts).toEqual([]);
  });

  it("imports a batch, deduping by url and reporting bad rows", async () => {
    const response = await importContacts(
      request("POST", [
        { name: "Pod", url: "https://pod.example" },
        { name: "Pod again", url: "pod.example/" },
        { name: "No url" }
      ])
    );
    const json = await response.json();
    expect(json).toMatchObject({ added: 1, updated: 1 });
    expect(json.skipped).toHaveLength(1);
    expect((await readOutreachStore()).contacts).toHaveLength(1);
  });

  it("saves the thread template apart from the creator template", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost:3000/api/outreach", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadTemplate: "Hi, I saw {thread}." })
      })
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.threadTemplate).toBe("Hi, I saw {thread}.");
    expect(body.template).not.toBe("Hi, I saw {thread}.");
  });

  it("refuses a write from another origin", async () => {
    const foreign = new NextRequest("http://localhost:3000/api/outreach", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", host: "localhost:3000", origin: "https://evil.example" },
      body: JSON.stringify({ template: "x" })
    });
    expect((await PATCH(foreign)).status).toBe(403);
  });

  it("reports a corrupt file instead of reading it as an empty list", async () => {
    await writeFile(dataPath("outreach.json"), "{ not json", "utf8");
    const response = await GET();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/outreach\.json could not be read/);
    await writeFile(dataPath("outreach.json"), JSON.stringify({ contacts: [] }), "utf8");
  });
});
