import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuotaMeter } from "@/components/uploading-center/quota-meter";
import type { YoutubeQuota } from "@/lib/publisher/quota";

(globalThis as { React?: typeof React }).React = React;

function quota(overrides: Partial<YoutubeQuota> = {}): YoutubeQuota {
  return {
    date: "2026-10-13",
    uploadsUsed: 2,
    uploadsPending: 1,
    projectedUploads: 3,
    budgetUploads: 6,
    remainingUploads: 4,
    usedUnits: 3_402,
    unitsPerUpload: 1_600,
    dailyUnits: 10_000,
    overBudget: false,
    split: [
      { purpose: "upload", units: 3_200 },
      { purpose: "analytics", units: 12 },
      { purpose: "inbox", units: 40, cap: 200 },
      { purpose: "inbox-reply", units: 50 },
      { purpose: "listening", units: 100, cap: 100 }
    ],
    nonUploadAllowance: 300,
    nonUploadSpent: 202,
    ledgerReadable: true,
    ...overrides
  };
}

function text(value: YoutubeQuota): string {
  return renderToStaticMarkup(createElement(QuotaMeter, { quota: value })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("the Uploading Center quota meter", () => {
  it("shows what each purpose has spent from the ledger, with the sub-caps that bound it", () => {
    const shown = text(quota());

    expect(shown).toContain("Uploads 3,200");
    expect(shown).toContain("Analytics 12");
    expect(shown).toContain("Inbox 40/200");
    expect(shown).toContain("Inbox replies 50");
    expect(shown).toContain("Listening 100/100");
  });

  it("shows uploads left from the ledger and the day's units", () => {
    const shown = text(quota());

    expect(shown).toContain("4 uploads left");
    expect(shown).toContain("3,402/10,000 units");
  });

  it("shows how much of the non-upload allowance is gone", () => {
    expect(text(quota())).toContain("202/300 for everything else");
  });

  it("says one upload is left in the singular", () => {
    expect(text(quota({ remainingUploads: 1 }))).toContain("1 upload left");
  });

  it("says when the ledger could not be read and the numbers come from the queue", () => {
    const shown = text(quota({ ledgerReadable: false, split: [{ purpose: "upload", units: 3_200 }], usedUnits: 3_200 }));

    expect(shown).toMatch(/ledger could not be read/i);
    expect(shown).not.toContain("for everything else");
  });

  it("keeps the warning when more uploads are waiting than the day's budget", () => {
    const shown = text(quota({ overBudget: true, projectedUploads: 8 }));

    expect(shown).toContain("8 uploads waiting");
  });
});
