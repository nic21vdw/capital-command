import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTREACH_TEMPLATE,
  applyStatus,
  countByStatus,
  dueForFollowUp,
  mergeContacts,
  normalizeContactUrl,
  outreachContactSchema,
  renderOutreachTemplate,
  weeklyPace,
  type OutreachContact
} from "@/lib/outreach/model";
import { readOutreachStore, updateOutreachStore } from "@/lib/outreach/store";

const NOW = "2026-10-11T12:00:00.000Z";

function contact(overrides: Partial<OutreachContact> = {}): OutreachContact {
  return outreachContactSchema.parse({
    id: "contact-1",
    name: "Agent Dev Weekly",
    url: "https://www.youtube.com/@agentdev",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  });
}

describe("merging contacts", () => {
  it("dedupes by url, ignoring protocol, www, case and trailing slash", () => {
    expect(normalizeContactUrl("HTTPS://www.YouTube.com/@AgentDev/")).toBe(normalizeContactUrl("youtube.com/@agentdev"));
    const result = mergeContacts([contact()], [{ name: "Agent Dev", url: "youtube.com/@AgentDev/", approxAudience: "40k" }], NOW);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].approxAudience).toBe("40k");
  });

  it("never wipes fields the import leaves out", () => {
    const existing = contact({ status: "replied", notes: "Wants a demo", licenceSent: true });
    const result = mergeContacts([existing], [{ name: "Agent Dev Weekly", url: existing.url, fit: "Runs agents daily" }], NOW);
    expect(result.contacts[0]).toMatchObject({ status: "replied", notes: "Wants a demo", licenceSent: true, fit: "Runs agents daily", id: "contact-1" });
  });

  it("adds new contacts with defaults and dedupes within one import", () => {
    const result = mergeContacts(
      [],
      [
        { name: "Pod One", url: "https://pod.one", platform: "podcast", recentVideo: { title: "Ep 12", url: "https://pod.one/12" } },
        { name: "Pod One again", url: "pod.one/" }
      ],
      NOW
    );
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.contacts[0]).toMatchObject({ status: "to-contact", licenceSent: false, platform: "podcast", name: "Pod One again" });
    expect(result.contacts[0].id).toMatch(/^contact-/);
  });

  it("reports invalid rows instead of dropping them silently", () => {
    const result = mergeContacts([], [{ name: "No url" }, { url: "https://x.com/someone", name: "Someone", status: "maybe" }, "junk"], NOW);
    expect(result.added).toBe(0);
    expect(result.skipped.map((row) => row.index)).toEqual([0, 1, 2]);
  });
});

describe("readings", () => {
  const today = "2026-10-11";

  it("lists open contacts whose follow-up has arrived, oldest first", () => {
    const due = dueForFollowUp(
      [
        contact({ id: "a", url: "a", nextFollowUpAt: "2026-10-10", status: "contacted" }),
        contact({ id: "b", url: "b", nextFollowUpAt: "2026-10-12", status: "contacted" }),
        contact({ id: "c", url: "c", nextFollowUpAt: "2026-10-01", status: "replied" }),
        contact({ id: "d", url: "d", nextFollowUpAt: "2026-10-01", status: "declined" }),
        contact({ id: "e", url: "e", nextFollowUpAt: today, status: "contacted" })
      ],
      today
    );
    expect(due.map((entry) => entry.id)).toEqual(["c", "a", "e"]);
  });

  it("counts contacts reached in the last seven days against the 5-10 target", () => {
    const list = ["2026-10-11", "2026-10-05", "2026-10-04", "2026-10-12"].map((date, i) =>
      contact({ id: String(i), url: String(i), lastContactedAt: date })
    );
    const pace = weeklyPace(list, today);
    expect(pace.contacted).toBe(2);
    expect(pace.state).toBe("behind");
    const busy = Array.from({ length: 11 }, (_, i) => contact({ id: String(i), url: String(i), lastContactedAt: today }));
    expect(weeklyPace(busy, today).state).toBe("over");
    expect(weeklyPace(busy.slice(0, 7), today).state).toBe("on-pace");
  });

  it("counts every status", () => {
    const counts = countByStatus([contact(), contact({ status: "deal" })]);
    expect(counts["to-contact"]).toBe(1);
    expect(counts.deal).toBe(1);
    expect(counts.replied).toBe(0);
  });
});

describe("status changes", () => {
  it("stamps today and books a follow-up a week out when marked contacted", () => {
    const next = applyStatus(contact(), "contacted", "2026-10-11", NOW);
    expect(next.lastContactedAt).toBe("2026-10-11");
    expect(next.nextFollowUpAt).toBe("2026-10-18");
  });

  it("keeps a follow-up already booked later", () => {
    const next = applyStatus(contact({ nextFollowUpAt: "2026-11-01" }), "contacted", "2026-10-11", NOW);
    expect(next.nextFollowUpAt).toBe("2026-11-01");
  });

  it("clears the follow-up when a conversation closes", () => {
    const next = applyStatus(contact({ status: "contacted", nextFollowUpAt: "2026-10-18" }), "declined", "2026-10-11", NOW);
    expect(next.nextFollowUpAt).toBeUndefined();
  });
});

describe("outreach template", () => {
  it("personalises {name} and {video}", () => {
    const text = renderOutreachTemplate("Hi {name}, loved {video}.", contact({ recentVideo: { title: "Five agents at once", url: "" } }));
    expect(text).toBe('Hi Agent Dev Weekly, loved "Five agents at once".');
  });

  it("never leaves a placeholder behind when there is no video", () => {
    const text = renderOutreachTemplate(DEFAULT_OUTREACH_TEMPLATE, contact());
    expect(text).not.toMatch(/\{name\}|\{video\}/);
    expect(text).toContain("your recent video");
  });

  it("describes CoLateral as the all-in-one agentic workspace and nothing else", () => {
    expect(DEFAULT_OUTREACH_TEMPLATE).toContain("the all-in-one agentic workspace");
    expect(DEFAULT_OUTREACH_TEMPLATE).not.toMatch(/engineer|structural|beam|column|code check/i);
  });
});

describe("outreach store", () => {
  it("starts empty with the default template and persists contacts", async () => {
    const initial = await readOutreachStore();
    expect(initial.contacts).toEqual([]);
    expect(initial.template).toBe(DEFAULT_OUTREACH_TEMPLATE);
    await updateOutreachStore((store) => ({ ...store, contacts: mergeContacts(store.contacts, [{ name: "A", url: "https://a.dev" }]).contacts }));
    const saved = await readOutreachStore();
    expect(saved.contacts.map((entry) => entry.url)).toEqual(["https://a.dev"]);
  });
});
