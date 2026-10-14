"use client";

import Link from "next/link";
import { changeReviewPolicy, useReviewPolicy } from "@/components/layout/review-policy";
import {
  REVIEW_CHANNELS,
  REVIEW_CHANNEL_LABELS,
  REVIEW_MODES,
  reviewChange,
  type ReviewMode
} from "@/lib/publisher/approval";

const MODE_LABELS: Record<ReviewMode, string> = { auto: "Auto", hold: "Hold" };

export function ReviewPolicySettings() {
  const { policy, busy, error, policyError, notice } = useReviewPolicy();
  return (
    <div className="mt-5 rounded-xl border border-[var(--border)] px-4 py-4" role="group" aria-label="Review before posting">
      <h3 className="text-sm font-semibold text-white">Review before posting</h3>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
        Auto posts at its slot, as it does today. Hold keeps new posts for your approval on the{" "}
        <Link href="/uploading-center" className="font-medium text-[var(--accent)] underline-offset-2 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
          Uploading Center
        </Link>{" "}
        until you approve them. Posts already on a platform are not affected.
      </p>
      <ul className="mt-3 divide-y divide-[var(--border)]">
        {REVIEW_CHANNELS.map((channel) => (
          <li key={channel} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span className="text-sm text-white">{REVIEW_CHANNEL_LABELS[channel]}</span>
            <span className="inline-flex rounded-lg border border-[var(--border)] p-0.5" role="group" aria-label={`${REVIEW_CHANNEL_LABELS[channel]} review mode`}>
              {REVIEW_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={policy[channel] === mode}
                  disabled={busy}
                  onClick={() => {
                    if (policy[channel] !== mode) void changeReviewPolicy(reviewChange(channel, mode));
                  }}
                  className={`min-h-8 rounded-md px-3 text-xs font-medium transition max-sm:min-h-10 ${
                    policy[channel] === mode
                      ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                      : "text-[var(--muted-foreground)] hover:text-white"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {policyError ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {policyError}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-xs text-[var(--muted-foreground)]">
          {notice}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-amber-200">{error}</p> : null}
    </div>
  );
}
