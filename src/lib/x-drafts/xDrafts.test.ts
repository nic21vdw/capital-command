import { describe, expect, it } from "vitest";
import { draftProblem, parseDrafts } from "@/lib/x-drafts/generator";
import { renderPhonePage } from "@/lib/x-drafts/phone";
import { bookDraftsOnThreads, datesDue, nextUnwrittenDate, slotTimes, threadsInstant } from "@/lib/x-drafts/schedule";
import { breaksPersona } from "@/lib/x-drafts/voice";
import type { XDraftsConfig } from "@/lib/x-drafts/config";
import type { XDraft, XDraftsState } from "@/lib/x-drafts/types";
import type { ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const config: XDraftsConfig = {
  enabled: true,
  perDay: 7,
  firstSlotMinutes: 8 * 60,
  gapMinutes: 120,
  threads: true,
  threadsOffsetMinutes: 30,
  writeAheadHour: 17,
  maxDaysAhead: 7,
  minLeadMinutes: 60,
  retryAfterMinutes: 120
};

const threads = {
  enabled: true,
  timezone: "America/Toronto",
  plugReplies: false,
  accounts: [
    { id: "primary", posts: "text", offsetMinutes: 0 },
    { id: "second", posts: "variant", offsetMinutes: 30 }
  ]
} as unknown as ThreadsConfig;

const GOOD =
  "Grok Bot users are still rationing requests in 2026.\n\nDots barely has limits and Duet made Opus 5.5 the default.\n\nSo what keeps you paying for the one you have to ration?";

function draft(overrides: Partial<XDraft> = {}): XDraft {
  return {
    id: "xdraft-1",
    batchDate: "2026-11-08",
    slot: 1,
    time: "08:00",
    topic: "Agent wars",
    text: GOOD,
    status: "new",
    createdAt: "2026-11-07T22:00:00.000Z",
    ...overrides
  };
}

const empty: XDraftsState = { version: 1, drafts: [] };

describe("X draft slots", () => {
  it("matches the every-two-hours X day, 8am to 8pm", () => {
    expect(slotTimes(config)).toEqual(["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"]);
  });

  it("puts the Threads copy about half an hour after the X slot, in the autopilot's timezone", () => {
    const at = threadsInstant(draft(), "America/Toronto", 30);
    const target = Date.parse("2026-11-08T13:30:00.000Z");
    expect(Math.abs(at.getTime() - target)).toBeLessThanOrEqual(8 * 60_000);
  });
});

describe("which days get written", () => {
  it("writes today when nothing is written and the day's slots are not over", () => {
    expect(datesDue(empty, new Date("2026-11-07T16:00:00.000Z"), "America/Toronto", config)).toEqual(["2026-11-07"]);
  });

  it("writes tomorrow in the evening, and not today once its last slot has passed", () => {
    expect(datesDue(empty, new Date("2026-11-08T02:00:00.000Z"), "America/Toronto", config)).toEqual(["2026-11-08"]);
  });

  it("does nothing for a day that already has drafts", () => {
    const state: XDraftsState = { version: 1, drafts: [draft({ batchDate: "2026-11-07" })] };
    expect(datesDue(state, new Date("2026-11-07T16:00:00.000Z"), "America/Toronto", config)).toEqual([]);
  });

  it("Write more picks the next day without drafts", () => {
    const state: XDraftsState = { version: 1, drafts: [draft({ batchDate: "2026-11-07" }), draft({ batchDate: "2026-11-08" })] };
    expect(nextUnwrittenDate(state, new Date("2026-11-07T16:00:00.000Z"), "America/Toronto", config)).toBe("2026-11-09");
  });
});

describe("what the writer is allowed to hand over", () => {
  it("accepts a hook that names a product, in short paragraphs, with no link", () => {
    expect(draftProblem(GOOD)).toBeNull();
  });

  it("refuses a link in the post, a nameless hook and anything over the Threads size", () => {
    expect(draftProblem(`${GOOD}\n\nTry it at colateralai.com`)).toMatch(/link/);
    expect(draftProblem("Most people are using agents wrong.\n\nOne task, one agent, then walk away. Who else learned this the hard way?")).toMatch(/names no/);
    expect(draftProblem(`Claude ${"x".repeat(500)}`)).toMatch(/too long/);
  });

  it("never lets a post call CoLateral engineering software or talk about selling to engineering firms", () => {
    expect(breaksPersona("CoLateral is the structural tool I sell")).toBe(true);
    expect(breaksPersona("We are selling CoLateral to engineering firms now")).toBe(true);
    expect(breaksPersona("Grok Bot vs Duet, who wins?")).toBe(false);
    expect(draftProblem("Claude Code made my structural checks faster.\n\nEngineering firms should switch. Which firm goes first?")).toMatch(/engineering/);
  });

  it("parses the reply, drops bad drafts and repeated hooks, and numbers the rest onto the day's slots", () => {
    let n = 0;
    const raw = JSON.stringify({
      drafts: [
        { topic: "Agent wars", text: GOOD },
        { topic: "Same", text: GOOD },
        { topic: "Plug", text: "Visit colateralai.com for Claude Code agents.\n\nIt rocks, what do you think?" },
        {
          topic: "Limits",
          text: "SuperGrok Heavy at $300 a month is lighting money on fire.\n\nSame money buys way more elsewhere.\n\nWhat's the priciest AI plan you cancelled?",
          reply: "I build this live in CoLateral [link]"
        }
      ]
    });
    const { drafts, dropped } = parseDrafts({ raw, date: "2026-11-08", times: ["08:00", "10:00"], recentOpenings: [], now: new Date(), newId: () => `d${(n += 1)}` });
    expect(drafts.map((entry) => [entry.slot, entry.time, entry.topic])).toEqual([
      [1, "08:00", "Agent wars"],
      [2, "10:00", "Limits"]
    ]);
    expect(drafts[1].reply).toContain("[link]");
    expect(dropped).toHaveLength(2);
  });

  it("keeps the blank lines between paragraphs and strips em dashes", () => {
    const raw = JSON.stringify({ drafts: [{ text: "Claude Code ships while Dots is still — checking.\n\n\n\nWho else noticed? Tell me what you saw this week." }] });
    const { drafts } = parseDrafts({ raw, date: "2026-11-08", times: ["08:00"], recentOpenings: [], now: new Date() });
    expect(drafts[0].text).not.toMatch(/—/);
    expect(drafts[0].text.split("\n\n")).toHaveLength(2);
  });
});

describe("booking drafts on Threads", () => {
  const now = new Date("2026-11-07T22:00:00.000Z");
  let n = 0;
  const newId = () => `thread-${(n += 1)}`;

  it("books every draft once, from one account, as a non-pack post the autopilot can't mistake for its own", () => {
    n = 0;
    const result = bookDraftsOnThreads({
      drafts: [draft(), draft({ id: "xdraft-2", slot: 2, time: "10:00", text: GOOD.replace("2026", "this year") })],
      queue: [],
      threads,
      config,
      now,
      newId
    });
    expect(result.items).toHaveLength(2);
    expect(new Set(result.items.map((item) => item.accountId))).toEqual(new Set(["primary"]));
    expect(result.items.every((item) => item.origin === "pipeline" && item.slot === 0 && item.status === "pending")).toBe(true);
    expect(result.items[0].sourceDraftId).toBe("xdraft-1");
    expect(result.items[0].text).toBe(GOOD);
    expect(result.booked.map((entry) => entry.draftId)).toEqual(["xdraft-1", "xdraft-2"]);
  });

  it("skips a slot whose Threads time is too close or already gone, and a text already queued", () => {
    n = 0;
    const queued = { id: "q", text: GOOD, status: "pending", publishAt: "2026-11-08T20:00:00.000Z" } as ThreadsQueueItem;
    const result = bookDraftsOnThreads({
      drafts: [draft(), draft({ id: "late", batchDate: "2026-11-07", time: "16:00", text: "Claude Duet is a product nobody asked for.\n\nWhat does it do that Projects can't?" })],
      queue: [queued],
      threads,
      config,
      now,
      newId
    });
    expect(result.items).toHaveLength(0);
    expect(result.notes.map((entry) => entry.draftId).sort()).toEqual(["late", "xdraft-1"]);
  });

  it("never books a dismissed draft or one already booked", () => {
    const result = bookDraftsOnThreads({
      drafts: [draft({ status: "dismissed" }), draft({ id: "b", threadsItemId: "thread-9" })],
      queue: [],
      threads,
      config,
      now
    });
    expect(result.items).toHaveLength(0);
  });

  it("says why when no Threads account is connected", () => {
    const result = bookDraftsOnThreads({ drafts: [draft()], queue: [], threads: { ...threads, accounts: [] }, config, now });
    expect(result.notes[0].note).toMatch(/No Threads account/);
  });
});

describe("the phone page", () => {
  it("lists upcoming drafts with copy buttons, escapes the text and leaves out dismissed ones", () => {
    const html = renderPhonePage(
      {
        version: 1,
        drafts: [
          draft({ text: "Claude <b>Code</b> & Dots\n\nWho wins?", threadsAt: "2026-11-08T13:31:00.000Z" }),
          draft({ id: "gone", status: "dismissed", text: "Dismissed draft text" }),
          draft({ id: "old", batchDate: "2026-11-01", text: "Old draft text" })
        ]
      },
      { today: "2026-11-07", timeZone: "America/Toronto", generatedAt: new Date("2026-11-07T22:00:00.000Z") }
    );
    expect(html).toContain("Claude &lt;b&gt;Code&lt;/b&gt; &amp; Dots");
    expect(html).toContain("Threads at 8:31 AM");
    expect(html).toContain("8am on X");
    expect(html).not.toContain("Dismissed draft text");
    expect(html).not.toContain("Old draft text");
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });
});
