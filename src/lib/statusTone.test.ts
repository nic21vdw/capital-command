import { describe, expect, it } from "vitest";
import { SCHEDULED_WORD, statusTone, statusWord } from "@/lib/statusTone";

describe("status colours", () => {
  it("paints a booked post blue, never the amber of a post that needs a look", () => {
    for (const status of ["scheduled", "Scheduled", "queued", "pending", "uploaded", "Posts at slot", "To inbox at slot"]) expect(statusTone(status), status).toBe("info");
  });

  it("paints everything that needs attention amber", () => {
    for (const status of ["overdue", "Overdue", "should be live", "Should be live", "shouldBeLive", "needs connection", "awaiting connection", "Needs YouTube connection", "Post by hand", "Retry to post", "Waiting for quota"]) {
      expect(statusTone(status), status).toBe("warning");
    }
  });

  it("keeps red for failures and green for what is out", () => {
    for (const status of ["failed", "Failed", "partly failed", "error"]) expect(statusTone(status), status).toBe("danger");
    for (const status of ["published", "Published", "posted", "live", "sent"]) expect(statusTone(status), status).toBe("success");
  });

  it("gives no verdict to a draft, a skipped slot or a word it does not know", () => {
    for (const status of ["draft", "skipped", "planned", "editing", ""]) expect(statusTone(status), status).toBe("neutral");
  });

  it("never lets scheduled share a tone with needs-attention or failed", () => {
    const tones = new Set((["scheduled", "overdue", "failed", "published"] as const).map(statusTone));
    expect(tones.size).toBe(4);
  });
});

describe("the word for booked but not posted", () => {
  it("says Scheduled for queued and pending, and leaves other statuses as they are", () => {
    expect(statusWord("queued")).toBe(SCHEDULED_WORD);
    expect(statusWord("pending")).toBe(SCHEDULED_WORD);
    expect(statusWord("published")).toBe("published");
    expect(statusWord("partly failed")).toBe("partly failed");
  });
});
