# Threads source fixes and draft content

This change fixes reproduced scheduling and publish-safety defects. It does **not** establish whether the current feed drop came from fewer publications, a production failure, weaker reach, or weaker conversion: current posts, live queues, task state, logs and analytics were unavailable in this environment.

## Before and after

All observations below use synthetic inputs and mocked providers. They are not live account metrics.

| Verified baseline behavior | Resulting source behavior |
| --- | --- |
| A simulated lost publish response made three publish calls and then said the container did not publish. | One publish request follows a saved attempt guard. An uncertain result holds the parent or reply for receipt reconciliation across ticks and restarts. |
| An existing completely missed batch returned no catch-up plan despite twelve hours remaining. | Eligible unsent rows can recover, with their saved IDs, wording and approvals, at the configured catch-up spacing and inside the posting window. |
| Pending rows could be cleared before replacement generation finished. | Catch-up prepares its replacement first, then relays eligible rows atomically. Failed, attempted, in-flight, manually skipped and uncertain slots stay protected. |
| Existing due posts waited behind generation, and a planner exception stopped their delivery. | Already queued due delivery runs first. Planning failure is reported separately; new future rows wait for the next tick. |
| A synthetic 07:00–23:00 window produced a last slot at 23:10. | Jitter stays within the window; the layout reserves account offsets and drops a boundary slot consistently across accounts if it cannot fit. |
| A skipped-only day read “all sent.” | Fully skipped ideas, including a day containing separate fully sent and fully skipped ideas, no longer produce that headline. |
| Skip could return success while an already claimed post continued publishing. | Skip rejects an in-flight parent with 409. Reschedule and batch shift preserve started rows and their delivery claims. A skip before a claim still stops the send. |

The baseline is pinned to main `59454b4464665d1dde79b4fad78eb983d86542c3`. Reproduce four of these observations with `node docs/reviews/threads-2026-10-14/baseline-repro.mjs`; [the receipt](evidence/baseline.json) records them. The script extracts actual baseline function bodies and uses stubs without reading queues or making requests.

## Deliverables and validation

- [Eight review-only draft pairs](CONTENT-DRAFTS.md), each with a hook, proof to demonstrate, and separate CTA reply. Both versions meet the existing short/warm length ranges. Four additional grounded workflow/business pairs are added to the fallback library.
- [595 tests across 39 files passed](evidence/focused-tests.txt), including approval, recovery, persistence, parent/reply publication, removal safety, window boundaries, the inbox publish caller, editorial rules and brand contracts.
- [The review follow-up passed 84 tests across six affected files](evidence/skip-followup-tests.txt), including six new skip regressions. A real route/runner test waits during mocked container creation and confirms an in-flight skip is rejected; a pre-claim skip makes no provider request. These counts describe separate overlapping runs.
- [The final control follow-up passed 143 tests across eight affected files](evidence/move-followup-tests.txt), covering reschedule/shift before skip during container creation, retained claims/receipts, and ordinary unstarted moves. Typecheck passed again after these source changes.
- [Required typecheck passed](evidence/typecheck.txt). [Diff check passed](evidence/diff-check.txt).
- [Implementation details and limits](IMPLEMENTATION-NOTES.md), [prepared changelog entry](CHANGELOG-ENTRY.md), and [owner handoff with live evidence prerequisites](OWNER-HANDOFF.md).

GPT-6.1 Sol handled delegated investigation and implementation. A separate [independent review](INDEPENDENT-REVIEW.md) accepted the final source with the stated limits after two control-race corrections.

## Integration constraints

Existing [PR499](https://github.com/nic21vdw/capital-command/pull/499) was reviewed before edits, and its account/editor/TikTok paths remain with its owner. The website owner retains conversion changes and legitimate destination analytics. Append the supplied changelog entry before integration. The application owner controls installation, rebuilding and restarting the running Marketing app. Desktop 1.0.73 is unchanged.

An uncertain result or legacy container with no reliable receipt is intentionally held, including beyond normal retention. Resolve it privately against the actual Threads post before considering any retry; this change adds no provider reconciliation endpoint or automatic override. Conservative holds may reduce delivery until reconciliation.

The existing idea roll-up still treats a slot published on one account and skipped on another as sent. The headline correction does not change that historical cross-account contract. For the live frequency diagnosis, count confirmed receipts separately per account rather than using the idea-level progress total.

No posts or replies were sent, no new publishing cadence was authorized, no ads were bought, no consent or credentials were changed, and no runtime was deployed. Owner-session acknowledgement and the actual production diagnosis remain pending supported access.
