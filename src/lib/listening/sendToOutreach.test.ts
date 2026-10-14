import { rm } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import type { ListeningResult } from "@/lib/listening/model";
import { sendHitToOutreach } from "@/lib/listening/outreach";
import { DEFAULT_THREAD_TEMPLATE, renderOutreachTemplate } from "@/lib/outreach/model";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";
import { readOutreachStore, updateOutreachStore } from "@/lib/outreach/store";
import { dataPath } from "@/lib/paths";

function hit(overrides: Partial<ListeningResult> & { id: string }): ListeningResult {
  return {
    source: "reddit",
    title: "r/StructuralEngineering: Revit model checking",
    url: "https://www.reddit.com/r/StructuralEngineering/comments/zzz111/revit_model_checking/",
    author: "dana",
    createdAt: "2026-10-12T10:00:00.000Z",
    excerpt: "Anyone know a structural engineering AI that can sanity check a Revit model?",
    matchedTerms: ["structural engineering AI", "Revit"],
    status: "new",
    note: "",
    foundAt: "2026-10-12T12:00:00.000Z",
    category: "lead",
    sentiment: 0.1,
    score: 91,
    reason: "Asks for a tool that checks Revit models",
    classifiedBy: "ai",
    alsoOn: [],
    ...overrides
  };
}

async function seed(...results: ListeningResult[]) {
  await updateListeningStore((store) => ({ ...store, results }));
}

beforeEach(async () => {
  await rm(dataPath("listening.json"), { force: true });
  await rm(dataPath("outreach.json"), { force: true });
});

describe("Send to Outreach", () => {
  it("turns a lead into an outreach contact that points at the thread, and marks the hit sent", async () => {
    await seed(hit({ id: "reddit-1" }));

    const sent = await sendHitToOutreach("reddit-1");

    const outreach = await readOutreachStore();
    expect(outreach.contacts).toHaveLength(1);
    const contact = outreach.contacts[0];
    expect(sent).toEqual({ contactId: contact.id, created: true });
    expect(contact).toMatchObject({
      name: "dana on Reddit",
      url: "https://www.reddit.com/r/StructuralEngineering/comments/zzz111/revit_model_checking/",
      platform: "other",
      kind: "thread",
      topic: "r/StructuralEngineering: Revit model checking",
      status: "to-contact"
    });
    expect(contact.recentVideo).toBeUndefined();
    expect(contact.fit).toContain("Asks for a tool that checks Revit models");
    expect(contact.angle).toMatch(/built CoLateral/i);
    expect(contact.notes).toContain("Revit model checking");
    expect(contact.notes).toContain("Anyone know a structural engineering AI");

    const stored = (await readListeningStore()).results[0];
    expect(stored.status).toBe("sent-to-outreach");
    expect(stored.outreachContactId).toBe(contact.id);
  });

  it("files a YouTube hit as a YouTube thread contact, with no recent video for the template to claim to have watched", async () => {
    await seed(
      hit({
        id: "youtube-1",
        source: "youtube",
        title: "ETABS vs SAP2000 for a 12 storey frame",
        url: "https://www.youtube.com/watch?v=vid0001",
        author: "Struct Dev"
      })
    );

    await sendHitToOutreach("youtube-1");

    const [contact] = (await readOutreachStore()).contacts;
    expect(contact).toMatchObject({ name: "Struct Dev on YouTube", platform: "youtube", kind: "thread" });
    expect(contact.recentVideo).toBeUndefined();
    expect(renderOutreachTemplate(DEFAULT_THREAD_TEMPLATE, contact)).not.toMatch(/watch|your recent video/i);
  });

  it("strips the comment prefix from the topic of a YouTube comment", async () => {
    await seed(hit({ id: "youtube-2", source: "youtube", title: "Comment on: ETABS vs SAP2000", url: "https://www.youtube.com/watch?v=vid0001&lc=UgxAAA", author: "Dana" }));
    await sendHitToOutreach("youtube-2");
    const [contact] = (await readOutreachStore()).contacts;
    expect(contact.topic).toBe("ETABS vs SAP2000");
    expect(renderOutreachTemplate(DEFAULT_THREAD_TEMPLATE, contact)).toContain('"ETABS vs SAP2000"');
  });

  it("names a hit with no author by its source", async () => {
    await seed(hit({ id: "hn-1", source: "hn", author: "", url: "https://news.ycombinator.com/item?id=1" }));
    await sendHitToOutreach("hn-1");
    expect((await readOutreachStore()).contacts[0].name).toBe("A Hacker News post");
  });

  it("is safe to repeat: no second contact, and nothing Nic wrote on the contact is overwritten", async () => {
    await seed(hit({ id: "reddit-1" }));
    const first = await sendHitToOutreach("reddit-1");
    await updateOutreachStore((store) => ({
      ...store,
      contacts: store.contacts.map((contact) => ({ ...contact, notes: "Wants a demo", status: "contacted" as const }))
    }));

    const again = await sendHitToOutreach("reddit-1");

    expect(again).toEqual({ contactId: first.contactId, created: false });
    const { contacts } = await readOutreachStore();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ notes: "Wants a demo", status: "contacted" });
  });

  it("reuses a contact already on the list for that url, whatever its spelling", async () => {
    await seed(hit({ id: "reddit-1" }));
    await updateOutreachStore((store) => ({
      ...store,
      contacts: [
        {
          id: "contact-mine",
          name: "Dana (met at conf)",
          url: "HTTPS://WWW.REDDIT.COM/r/StructuralEngineering/comments/zzz111/revit_model_checking",
          platform: "other",
          kind: "creator",
          topic: "",
          approxAudience: "",
          fit: "",
          angle: "",
          status: "to-contact",
          licenceSent: false,
          notes: "mine",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z"
        }
      ]
    }));

    const sent = await sendHitToOutreach("reddit-1");

    expect(sent).toEqual({ contactId: "contact-mine", created: false });
    expect((await readOutreachStore()).contacts).toHaveLength(1);
    expect((await readListeningStore()).results[0].status).toBe("sent-to-outreach");
  });

  it("can send a hit that was dismissed, because choosing to send is the decision", async () => {
    await seed(hit({ id: "reddit-1", status: "dismissed" }));
    await sendHitToOutreach("reddit-1");
    expect((await readListeningStore()).results[0].status).toBe("sent-to-outreach");
  });

  it("refuses an id that is not on the list, and writes nothing", async () => {
    await seed(hit({ id: "reddit-1" }));
    await expect(sendHitToOutreach("nope")).rejects.toThrow(/No result with that id/);
    expect((await readOutreachStore()).contacts).toEqual([]);
  });
});
