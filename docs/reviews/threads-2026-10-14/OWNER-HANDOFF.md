# Threads investigation and owner handoff

This source task starts from main `59454b4464665d1dde79b4fad78eb983d86542c3`. The existing account/editor/TikTok draft [PR499](https://github.com/nic21vdw/capital-command/pull/499) was reviewed before edits. None of its changed source paths are owned by this task.

## What is established

The repository has a daily Threads planner, a separate per-account publishing queue, a five-minute Windows scheduled task, token-refresh and auth-breaker logic, explicit review holds, and a provider insights reader. Publication receipts are different from scheduler exit codes. Missing insights are absent values, not zero. An attribution URL is different from a measured website visit.

The available clone contains only `data/.gitkeep`; it contains no actual queue, schedules, scheduler logs or analytics records. No current production publication count, drop in reach, click total, conversion rate, or cause of the reported drop was established here. Existing documentation contains historical incidents; those do not establish the present cause.

## Ownership and coordination

- Threads task: scheduling, provider publishing reliability, content templates and the accompanying review-only drafts.
- Marketing product owner: PR499 account reads/editor saves/TikTok and running Marketing application release.
- Conversion website owner: destination usability, actual visits and conversion evidence.
- Desktop release ownership and immutable 1.0.73 remain separate.

The supported `codex queue` coordination attempt failed because this environment's shared Codex state database could not be initialized. Desktop Commander reported no connected devices. Consequently neither owner has acknowledged this task from this environment. The parent coordinator must deliver this handoff to the supplied owner sessions.

## Exact prerequisite for the live diagnosis

Use an already authorized connection to the Windows production device and its local app, or have the owner provide a sanitized read-only export. Do not create credentials or grants. Keep raw account IDs, handles, tokens, personal details, customer material and log bodies out of public review evidence.

The minimum evidence is:

1. Read-only `GET /api/threads`: saved timezone and posting window, configured daily target, pause/approval state, heartbeat, queue status and confirmed post IDs. Retain a private account mapping; aggregate publication separately for each account.
2. Saved `threads-state.json`, the recent `threads-autopilot.log` and retained dated logs, automation history, and the existing Windows scheduled task's action, working directory, enabled state, last run and result. Reading these is different from registering or executing the task. The running build commit is different from repository main.
3. Actual Threads posts and confirmed receipts, reconciled by platform post ID and publication timestamp. For an uncertain send, check the existing post before any retry. Compare intended slots, approved slots, observed attempts and confirmed publications in the same local-day window.
4. Existing `GET /api/analytics?platform=threads&since=28d&sort=published&top=500`, plus the saved analytics sync status and notes. A limited response is not an exhaustive post census. Use retained metrics for posts no longer in the 14-day queue. Check freshness, metric source, permission notes and missing coverage before comparing reach.
5. Website owner's existing analytics for `/th`, available attribution tags, sessions and the defined conversion event over matching periods. Do not add tracking, change consent, buy ads or infer purchases from posts.

Classify a frequency problem when approved planned slots exceed confirmed publications and reconcile the gap with missing ticks, sleep/offline periods, missed slots, approval holds, disabled settings or failed generation. Classify a technical failure only from error/attempt evidence and its receipt outcome. Assess reach after comparing measured posts of similar age and acknowledging missing coverage. Assess conversion only from legitimate destination analytics. More than one cause may apply.

## Publication and release boundaries

The source PR and content drafts authorize neither a new post nor a cadence increase. Approval contracts, idempotency and uncertain-send holds must survive deployment. The application owner must install/rebuild the Marketing app at an appropriate time; no update/restart, task registration, desktop release, OAuth grant, ad purchase or publication occurred in this task.
