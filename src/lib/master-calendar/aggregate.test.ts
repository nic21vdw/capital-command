import { describe, expect, it } from "vitest";
import { buildMasterCalendarEvents } from "@/lib/master-calendar/aggregate";
import { buildDaySummary } from "@/lib/master-calendar/day-summary";
import { summarizeEventStatus } from "@/lib/master-calendar/legSummary";
import { eventStatusLabel, isLateEventStatus } from "@/lib/master-calendar/types";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import type { AppData } from "@/types/domain";

const emptyData = { contentItems: [] } as unknown as AppData;

const item = (over: Partial<QueueItem>): QueueItem =>
  ({
    id: "q1",
    clipPath: "data/clips/outputs/job1/clip-1.mp4",
    title: "A short",
    caption: "",
    hashtags: [],
    publishAt: "2026-08-08T15:30:00.000Z",
    visibility: "public",
    createdAt: "2026-08-07T00:00:00.000Z",
    platforms: { youtube: { status: "scheduled", attempts: 0 } },
    ...over
  }) as QueueItem;

// The default item's slot is 2026-08-08T15:30Z. `before` keeps every fixture
// ahead of its slot (so "scheduled" stays scheduled whatever day the suite runs);
// the past-slot specs below pass a later clock.
const before = new Date("2026-08-07T12:00:00.000Z");
const events = (queueItems: QueueItem[], now: Date = before, isConnected?: (platform: PlatformId, accountId: string) => boolean) =>
  buildMasterCalendarEvents({
    isConnected,
    data: emptyData,
    queueItems,
    timeZone: "America/Toronto",
    startKey: "2026-08-08",
    days: 2,
    now
  });

describe("what a booked queue item reads as on the calendar", () => {
  it("files a picture post under Carousels, not Shorts", () => {
    const [event] = events([
      item({
        id: "q2",
        clipPath: "data/carousels/deck-1/slide-01.jpg",
        mediaKind: "image",
        imagePaths: ["data/carousels/deck-1/slide-01.jpg", "data/carousels/deck-1/slide-02.jpg"],
        title: "What one stream produces",
        platforms: { instagram: { status: "scheduled", attempts: 0 } }
      } as Partial<QueueItem>)
    ]);
    expect(event.source).toBe("queued-carousels");
    expect(event.id.startsWith("queued-carousels:")).toBe(true);
    expect(event.href).toBe("/carousels?open=deck-1");
  });

  it("carries what happened on each platform, for per-platform roll-ups", () => {
    const [event] = events([
      item({
        platforms: {
          youtube: { status: "published", postId: "abcdefghijk", attempts: 1 },
          instagram: { status: "published", postId: "17900000000000001", attempts: 1 },
          tiktok: { status: "manual", attempts: 0 }
        }
      })
    ]);
    expect(event.legs).toEqual([
      {
        platform: "YouTube",
        status: "published",
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        href: "/uploading-center?item=q1&platform=youtube"
      },
      { platform: "Instagram", status: "published", href: "/uploading-center?item=q1&platform=instagram" },
      { platform: "TikTok", status: "manual", href: "/uploading-center?item=q1&platform=tiktok" }
    ]);
  });

  it("opens that queued short, not a job dropdown", () => {
    const [event] = events([item({})]);
    expect(event.source).toBe("shorts");
    expect(event.href).toBe("/uploading-center?item=q1&platform=youtube");
  });

  it("still names the short when it came from a clip job", () => {
    const [event] = events([item({ jobId: "job-9" })]);
    expect(event.href).toBe("/uploading-center?item=q1&platform=youtube");
  });
});

describe("a post whose slot has passed", () => {
  const after = new Date("2026-08-08T16:30:00.000Z"); // an hour past the 15:30Z slot
  const justAfter = new Date("2026-08-08T15:35:00.000Z"); // inside the publisher's grace

  it("reads 'should be live' when YouTube holds it past its time, and marks that leg", () => {
    const [event] = events([item({ platforms: { youtube: { status: "scheduled", postId: "abcdefghijk", attempts: 1 } } })], after);
    expect(event.status).toBe("should be live");
    expect(event.legs).toEqual([
      expect.objectContaining({ platform: "YouTube", status: "scheduled", late: "should-be-live" })
    ]);
  });

  it("stays 'scheduled' before the slot and inside the grace window", () => {
    const youtube = item({ platforms: { youtube: { status: "scheduled", postId: "abcdefghijk", attempts: 1 } } });
    expect(events([youtube])[0].status).toBe("scheduled");
    expect(events([youtube], justAfter)[0].status).toBe("scheduled");
    expect(events([youtube], justAfter)[0].legs![0].late).toBeUndefined();
  });

  it("reads 'overdue' when the publisher never sent a pending leg, unless the runner has it claimed", () => {
    const pending = item({ platforms: { instagram: { status: "pending", attempts: 0 } } });
    expect(events([pending], after)[0].status).toBe("overdue");
    const claimed = item({ platforms: { instagram: { status: "pending", attempts: 0, claimedAt: "2026-08-08T16:28:00.000Z" } } });
    expect(events([claimed], after)[0].status).toBe("queued");
  });

  it("ranks overdue above should-be-live, and a lost leg above both", () => {
    const mixed = item({
      platforms: {
        youtube: { status: "scheduled", postId: "abcdefghijk", attempts: 1 },
        instagram: { status: "pending", attempts: 0 }
      }
    });
    expect(events([mixed], after)[0].status).toBe("overdue");
    const withFailure = item({
      platforms: {
        youtube: { status: "scheduled", postId: "abcdefghijk", attempts: 1 },
        instagram: { status: "failed", attempts: 3 }
      }
    });
    expect(events([withFailure], after)[0].status).toBe("partly failed");
  });

  describe("when the account behind a pending leg is not connected", () => {
    const connectedExcept = (...missing: PlatformId[]) => (platform: PlatformId) => !missing.includes(platform);
    const pending = item({ platforms: { instagram: { status: "pending", attempts: 0 } } });

    it("reads 'needs connection', the board's wording, instead of 'overdue'", () => {
      const [event] = events([pending], after, connectedExcept("instagram"));
      expect(event.status).toBe("needs connection");
      expect(event.legs![0]).toMatchObject({ platform: "Instagram", status: "pending", late: "needs-connection" });
      expect(eventStatusLabel(event.status, event)).toBe("Needs Instagram connection");
    });

    it("only a CONNECTED platform's pending leg is overdue", () => {
      expect(events([pending], after, connectedExcept("youtube"))[0].status).toBe("overdue");
      expect(events([pending], after)[0].status).toBe("overdue");
    });

    it("asks about the post's own account, falling back to the platform's primary", () => {
      const asked: string[] = [];
      events([item({ accountId: "instagram-second", platforms: { instagram: { status: "pending", attempts: 0 } } })], after, (platform, accountId) => {
        asked.push(`${platform}:${accountId}`);
        return true;
      });
      expect(asked).toContain("instagram:instagram-second");
      const legacy: string[] = [];
      events([pending], after, (platform, accountId) => (legacy.push(`${platform}:${accountId}`), true));
      expect(legacy).toContain("instagram:instagram-primary");
    });

    it("ranks above overdue and should-be-live and below a failure", () => {
      const mixed = item({
        platforms: {
          youtube: { status: "scheduled", postId: "abcdefghijk", attempts: 1 },
          instagram: { status: "pending", attempts: 0 },
          tiktok: { status: "pending", attempts: 0 }
        }
      });
      const noTiktok = connectedExcept("tiktok");
      const [event] = events([mixed], after, noTiktok);
      expect(event.status).toBe("needs connection");
      expect(event.legs!.map((leg) => leg.late)).toEqual(["should-be-live", "overdue", "needs-connection"]);
      expect(eventStatusLabel(event.status, event)).toBe("Needs TikTok connection");
      const failed = item({ platforms: { instagram: { status: "pending", attempts: 0 }, facebook: { status: "failed", attempts: 3 } } });
      expect(events([failed], after, connectedExcept("instagram"))[0].status).toBe("partly failed");
    });

    it("is not late before the slot: it reads 'awaiting connection' with the leg flagged, not marked late", () => {
      const [event] = events([pending], before, connectedExcept("instagram"));
      expect(event.status).toBe("awaiting connection");
      expect(event.legs![0]).toMatchObject({ platform: "Instagram", status: "pending", awaitingConnection: true });
      expect(event.legs![0].late).toBeUndefined();
      expect(isLateEventStatus(event.status)).toBe(false);
      expect(eventStatusLabel(event.status, event)).toBe("Needs Instagram connection");
      // Inside the publisher's grace the slot has not been missed either.
      expect(events([pending], justAfter, connectedExcept("instagram"))[0].status).toBe("awaiting connection");
    });

    it("counts as 'needs connection' on the day, not as queued and not as late", () => {
      const [event] = events([pending], before, connectedExcept("instagram"));
      const day = buildDaySummary("2026-08-08", [event]);
      expect(day.states.needsConnection).toBe(1);
      expect(day.states.scheduled).toBe(0);
      expect(day.states.overdue).toBe(0);
    });

    it("only a connected account's pending leg stays 'queued' before the slot", () => {
      expect(events([pending], before, connectedExcept("youtube"))[0].status).toBe("queued");
      expect(events([pending], before)[0].status).toBe("queued");
      expect(events([pending], before)[0].legs![0].awaitingConnection).toBeUndefined();
    });

    it("flags only the unconnected legs of a post, and ranks below a late leg", () => {
      const mixed = item({
        platforms: {
          youtube: { status: "scheduled", postId: "abcdefghijk", attempts: 1 },
          instagram: { status: "pending", attempts: 0 },
          facebook: { status: "pending", attempts: 0 }
        }
      });
      const [event] = events([mixed], before, connectedExcept("instagram", "facebook"));
      expect(event.status).toBe("awaiting connection");
      expect(event.legs!.map((leg) => Boolean(leg.awaitingConnection))).toEqual([false, true, true]);
      expect(eventStatusLabel(event.status, event)).toBe("Needs connection");
      const summary = summarizeEventStatus(event);
      expect(summary.mixed).toBe(true);
      expect(summary.headline).toBe("YouTube is scheduled · Instagram, Facebook need connection");
      // Once the slot passes the same legs are the past-slot kind, and no longer "awaiting".
      const [past] = events([mixed], after, connectedExcept("instagram", "facebook"));
      expect(past.status).toBe("needs connection");
      expect(past.legs!.some((leg) => leg.awaitingConnection)).toBe(false);
    });
  });

  it("leaves a published post, a hand-post reminder and a long-form held for review alone", () => {
    expect(events([item({ platforms: { youtube: { status: "published", postId: "abcdefghijk", attempts: 1 } } })], after)[0].status).toBe("published");
    expect(events([item({ platforms: { tiktok: { status: "manual", attempts: 0 } } })], after)[0].status).toBe("queued");
    const held = item({ format: "long", platforms: { youtube: { status: "scheduled", postId: "abcdefghijk", attempts: 1 } } });
    expect(events([held], after)[0].status).toBe("scheduled");
  });
});

describe("sourceHrefForDay", () => {
  it("pages the uploading center to that calendar day", async () => {
    const { sourceHrefForDay } = await import("@/lib/master-calendar/aggregate");
    expect(sourceHrefForDay("shorts", "2026-08-14")).toBe("/uploading-center?day=2026-08-14");
    expect(sourceHrefForDay("x", "2026-08-14")).toBe("/x-posts?date=2026-08-14");
    expect(sourceHrefForDay("queued-carousels", "2026-08-14")).toBe("/carousels");
  });
});

describe("carouselIdFromQueuePath", () => {
  it("reads the deck id out of a queued slide path", async () => {
    const { carouselIdFromQueuePath } = await import("@/lib/master-calendar/aggregate");
    expect(carouselIdFromQueuePath("data/carousels/carousel-abc/slide-01.jpg")).toBe("carousel-abc");
    expect(carouselIdFromQueuePath("C:\\data\\carousels\\carousel-abc\\slide-01.jpg")).toBe("carousel-abc");
  });
});

describe("a post with one lost leg", () => {
  const partly = item({
    platforms: {
      youtube: { status: "published", postId: "abc123", attempts: 1 },
      instagram: { status: "failed", error: "boom", attempts: 3 }
    }
  });

  it("reads partly failed, not scheduled or published", () => {
    const [event] = events([partly]);
    expect(event.status).toBe("partly failed");
    expect(event.failedPlatforms).toEqual(["Instagram"]);
  });

  it("opens the tab that failed instead of the healthy YouTube one", () => {
    const [event] = events([partly]);
    expect(event.href).toBe("/uploading-center?item=q1&platform=instagram");
  });

  it("only says failed when every leg is dead", () => {
    const [event] = events([
      item({ platforms: { youtube: { status: "failed", attempts: 3 }, tiktok: { status: "failed", attempts: 3 } } })
    ]);
    expect(event.status).toBe("failed");
    expect(event.failedPlatforms).toEqual(["YouTube", "TikTok"]);
  });

  it("says why each lost leg failed, with a link to that platform's card", () => {
    const [event] = events([
      item({
        platforms: {
          youtube: { status: "failed", error: "invalid_grant: Token has been expired or revoked.", attempts: 3 },
          tiktok: { status: "failed", error: "boom", attempts: 3 }
        }
      })
    ]);
    expect(event.failures).toEqual([
      {
        platform: "YouTube",
        reason: "The YouTube connection expired or was revoked. Reconnect and this post goes out on its own.",
        href: "/uploading-center?item=q1&platform=youtube"
      },
      { platform: "TikTok", reason: "TikTok rejected this upload.", href: "/uploading-center?item=q1&platform=tiktok" }
    ]);
    expect(JSON.stringify(event.failures)).not.toContain("boom");
  });

  it("has no failures on a healthy post", () => {
    expect(events([item({ platforms: { youtube: { status: "published", postId: "abc123", attempts: 1 } } })])[0].failures).toBeUndefined();
  });

  it("sends a failed picture post to its Uploading Center card, where Retry is", () => {
    const [event] = events([
      item({
        id: "q9",
        clipPath: "data/carousels/deck-1/slide-01.jpg",
        mediaKind: "image",
        platforms: { instagram: { status: "failed", attempts: 3 } }
      } as Partial<QueueItem>)
    ]);
    expect(event.href).toBe("/uploading-center?item=q9&platform=instagram");
  });
});

describe("each platform's leg opens its own tab", () => {
  it("never sends an Instagram row to the TikTok tab that failed", () => {
    const [event] = events([
      item({
        platforms: {
          youtube: { status: "published", postId: "abc123", attempts: 1 },
          instagram: { status: "published", postId: "ig1", attempts: 1 },
          tiktok: { status: "failed", error: "boom", attempts: 3 }
        }
      })
    ]);
    // The event itself opens the platform that needs a look...
    expect(event.href).toBe("/uploading-center?item=q1&platform=tiktok");
    // ...but each leg opens its own.
    expect(event.legs?.map((leg) => [leg.platform, leg.href])).toEqual([
      ["YouTube", "/uploading-center?item=q1&platform=youtube"],
      ["Instagram", "/uploading-center?item=q1&platform=instagram"],
      ["TikTok", "/uploading-center?item=q1&platform=tiktok"]
    ]);
  });
});

describe("links to the live post", () => {
  it("builds Open links for published legs whose URL shape is known", () => {
    const [event] = events([
      item({
        platforms: {
          youtube: { status: "published", postId: "abc123", attempts: 1 },
          facebook: { status: "published", postId: "1234_5678", attempts: 1 },
          instagram: { status: "published", postId: "17900000000", attempts: 1 },
          tiktok: { status: "published", postId: "7300000000", attempts: 1 }
        }
      })
    ]);
    expect(event.liveLinks).toEqual([
      { platform: "YouTube", url: "https://www.youtube.com/watch?v=abc123" },
      { platform: "Facebook", url: "https://www.facebook.com/1234_5678" }
    ]);
  });

  it("names the YouTube video only once that leg is published", () => {
    const [published] = events([
      item({ id: "q7", platforms: { youtube: { status: "published", postId: "abc123XYZ_-", attempts: 1 } } })
    ]);
    expect(published.youtube).toEqual({ itemId: "q7", videoId: "abc123XYZ_-" });
    const [scheduled] = events([
      item({ platforms: { youtube: { status: "scheduled", postId: "abc123XYZ_-", attempts: 1 } } })
    ]);
    expect(scheduled.youtube).toBeUndefined();
  });

  it("does not link a Facebook post that has not gone live yet", () => {
    const [event] = events([item({ platforms: { facebook: { status: "scheduled", postId: "1234_5678", attempts: 1 } } })]);
    expect(event.liveLinks).toBeUndefined();
  });

  it("uses a stored full URL for Instagram or TikTok", () => {
    const [event] = events([
      item({ platforms: { instagram: { status: "published", postId: "https://www.instagram.com/reel/Cxyz/", attempts: 1 } } })
    ]);
    expect(event.liveLinks).toEqual([{ platform: "Instagram", url: "https://www.instagram.com/reel/Cxyz/" }]);
  });
});

describe("a long-form upload held for review", () => {
  it("is flagged so it does not read as a normal scheduled post", () => {
    const [event] = events([item({ format: "long", clipPath: "data/longform/p1/export.mp4" })]);
    expect(event.heldForReview).toBe(true);
  });

  it("also catches rows queued before the format was stamped", () => {
    const [event] = events([item({ clipPath: "data/longform/p1/export.mp4" })]);
    expect(event.heldForReview).toBe(true);
  });

  it("leaves shorts alone", () => {
    const [event] = events([item({})]);
    expect(event.heldForReview).toBeUndefined();
  });

  it("does not flag a long-form post that has no YouTube leg", () => {
    const [event] = events([
      item({ format: "long", platforms: { facebook: { status: "scheduled", attempts: 0 } } })
    ]);
    expect(event.heldForReview).toBeUndefined();
  });
});

describe("posts to make by hand", () => {
  it("lists the manual legs with their card, and the slides for a picture post", () => {
    const [video] = events([
      item({ platforms: { youtube: { status: "scheduled", attempts: 0 }, tiktok: { status: "manual", attempts: 0 } } })
    ]);
    expect(video.manual).toEqual([{ platform: "TikTok", href: "/uploading-center?item=q1&platform=tiktok" }]);

    const [picture] = events([
      item({
        id: "q3",
        clipPath: "data/carousels/deck-1/slide-01.jpg",
        mediaKind: "image",
        platforms: { instagram: { status: "manual", attempts: 0 } }
      } as Partial<QueueItem>)
    ]);
    expect(picture.manual).toEqual([
      { platform: "Instagram", href: "/uploading-center?item=q3&platform=instagram", fileUrl: "/api/publish/q3/images/0" }
    ]);
  });

  it("opens a manual-only post on the platform that needs the hand", () => {
    const [event] = events([item({ platforms: { youtube: { status: "published", attempts: 1 }, facebook: { status: "manual", attempts: 0 } } })]);
    expect(event.href).toBe("/uploading-center?item=q1&platform=facebook");
  });
});

describe("Threads on the calendar", () => {
  const pack = {
    id: "pack-1",
    date: "2026-08-08",
    source: "ai",
    createdAt: "2026-08-08T00:00:00.000Z",
    replies: [],
    posts: [1, 2, 3, 4].map((slot) => ({
      id: `p${slot}`,
      slot,
      time: `${String(8 + slot).padStart(2, "0")}:00`,
      format: "hot-take",
      topic: `Topic ${slot}`,
      text: `Text ${slot}`,
      threadsVariant: `Variant ${slot}`
    }))
  };
  const data = { contentItems: [], xPlanner: { packs: [pack] } } as unknown as AppData;
  const thread = (over: Partial<ThreadsQueueItem>): ThreadsQueueItem => ({
    id: "t1",
    batchDate: "2026-08-08",
    slot: 1,
    accountId: "acct-a",
    version: "text",
    topic: "Topic 1",
    format: "hot-take",
    text: "Text 1",
    publishAt: "2026-08-08T14:05:00.000Z",
    status: "pending",
    attempts: 0,
    createdAt: "2026-08-08T00:00:00.000Z",
    ...over
  });
  const xEvents = (threadsItems?: ThreadsQueueItem[]) =>
    buildMasterCalendarEvents({
      data,
      queueItems: [],
      threadsItems,
      timeZone: "America/Toronto",
      startKey: "2026-08-08",
      days: 1
    }).filter((event) => event.source === "x");

  describe("why a Threads post failed", () => {
    const failedSlot = (error?: string, extra: Partial<ThreadsQueueItem> = {}) =>
      xEvents([thread({ id: "t2", slot: 2, status: "failed", error, ...extra })]).find((event) => event.title === "Topic 2")!;

    it("says a dead login in the Automations wording and links to Settings", () => {
      const event = failedSlot("Threads API error (190): the access token has expired. Reconnect the account.");
      expect(event.failures).toEqual([
        {
          platform: "Threads",
          reason: "Threads connection expired - reconnect in Settings",
          href: "/settings#accounts",
          fixLabel: "Open Accounts in Settings"
        }
      ]);
    });

    it("links any other failure to that day on the Autopilot board, with a plain reason", () => {
      const event = failedSlot("Threads API error (4): Application request limit reached");
      expect(event.failures).toHaveLength(1);
      expect(event.failures![0]).toMatchObject({
        platform: "Threads",
        href: "/x-posts?date=2026-08-08",
        fixLabel: "Fix in Threads Autopilot"
      });
      expect(event.failures![0].reason).not.toBe("");
    });

    it("says so when no reason was recorded, and reads one line for two accounts failing alike", () => {
      expect(failedSlot(undefined).failures?.[0].reason).toBe("no reason was recorded");
      const two = xEvents([
        thread({ id: "a", slot: 2, accountId: "acct-a", status: "failed", error: "the access token has expired" }),
        thread({ id: "b", slot: 2, accountId: "acct-b", status: "failed", error: "the access token has expired" })
      ]).find((event) => event.title === "Topic 2")!;
      expect(two.failures).toHaveLength(1);
    });

    it("names the failed account's reason on a partly failed slot, and none on a healthy one", () => {
      const partly = xEvents([
        thread({ id: "a", slot: 1, accountId: "acct-a", status: "published" }),
        thread({ id: "b", slot: 1, accountId: "acct-b", status: "failed", error: "OAuthException" })
      ]).find((event) => event.title === "Topic 1")!;
      expect(partly.status).toBe("partly failed");
      expect(partly.failures?.[0].fixLabel).toBe("Open Accounts in Settings");
      expect(xEvents([thread({ status: "published" })])[0].failures).toBeUndefined();
    });

    it("also explains a failed post that has no pack behind it", () => {
      const event = xEvents([thread({ id: "old", slot: 9, topic: "Pruned pack", status: "failed", error: "OAuthException" })]).find(
        (e) => e.title === "Pruned pack"
      )!;
      expect(event.failures?.[0].reason).toBe("Threads connection expired - reconnect in Settings");
    });
  });

  it("keeps a slot nobody queued as planned, for X and Threads", () => {
    const result = xEvents([]);
    expect(result.map((event) => event.status)).toEqual(["planned", "planned", "planned", "planned"]);
    expect(result[0].platforms).toEqual(["X", "Threads"]);
    expect(xEvents(undefined).map((event) => event.status)).toEqual(["planned", "planned", "planned", "planned"]);
  });

  it("shows what really happened to each slot", () => {
    const result = xEvents([
      thread({ id: "t1", slot: 1, status: "published" }),
      thread({ id: "t2", slot: 2, status: "failed", error: "token expired" }),
      thread({ id: "t3", slot: 3, status: "skipped" }),
      thread({ id: "t4", slot: 4, status: "pending" })
    ]);
    expect(result.map((event) => event.status)).toEqual(["published", "failed", "skipped", "queued"]);
    expect(result[0].platforms).toEqual(["Threads"]);
    expect(result[1].failedPlatforms).toEqual(["Threads"]);
    expect(result[0].failedPlatforms).toBeUndefined();
  });

  it("rolls the accounts of one slot into one event, and calls a split result partly failed", () => {
    const result = xEvents([
      thread({ id: "a", accountId: "acct-a", status: "published" }),
      thread({ id: "b", accountId: "acct-b", status: "failed" })
    ]);
    expect(result).toHaveLength(4);
    expect(result.find((event) => event.title === "Topic 1")?.status).toBe("partly failed");
  });

  it("takes the real time from the queue, in the Threads time zone", () => {
    const first = xEvents([thread({ publishAt: "2026-08-08T14:05:00.000Z" })]).find((event) => event.title === "Topic 1");
    expect(first?.time).toBe("10:05");
  });

  it("adds a post that has no pack behind it, and a post from a stream", () => {
    const result = xEvents([
      thread({ id: "old", batchDate: "2026-08-08", slot: 9, topic: "Pruned pack", status: "published" }),
      thread({ id: "stream", batchDate: "2026-08-08", slot: 1, origin: "pipeline", topic: "From a stream", status: "failed" })
    ]);
    expect(result).toHaveLength(6);
    const stream = result.find((event) => event.title === "From a stream");
    expect(stream?.status).toBe("failed");
    // The stream post must not take over the autopilot's slot 1.
    expect(result.find((event) => event.title === "Topic 1")?.status).toBe("planned");
    expect(result.find((event) => event.title === "Pruned pack")?.status).toBe("published");
  });

  it("ignores queue items outside the window", () => {
    const result = xEvents([thread({ id: "far", batchDate: "2026-08-20", slot: 9 })]);
    expect(result).toHaveLength(4);
  });
});
