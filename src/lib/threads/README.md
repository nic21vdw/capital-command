# Threads autopilot

One batch of posts a day, written and sent without anyone opening the app.

This replaces the old routine — generate 24 posts, then schedule and upload
them by hand through a browser agent. The pack is the same one the X/Threads
Post Engine writes; the difference is that it now lands on a queue and posts
itself.

## The loop

`threadsTick()` (`daily.ts`) is the only entry point the scheduler needs, and
it does two things:

1. **Plan** — if today's batch isn't on the queue yet, get today's pack
   (`ensureDailyPack`, which generates it through DeepSeek on the first ask of
   the day and caches it in the app data store), and turn every slot into two
   queue items: the pack's `text` as the main post, and its `threadsVariant`
   as a reply under it three minutes later. Idempotent behind a batch-date
   check, so calling it every five minutes plans exactly once a day.
2. **Run** — post everything whose time has come (`runner.ts`).

Both steps are safe to repeat, which is the whole design: the scheduled task
is dumb and frequent, and the idempotency lives here.

## Why a reply and not two posts

The pack deliberately writes each idea twice — a punchier X line and a warmer
Threads rewrite. Posting both as separate top-level posts puts two versions of
the same thought in one feed minutes apart, which reads as spam. Posting the
rewrite as a reply makes the slot an actual thread. `THREADS_SECOND_POST`
switches it to `standalone` or `off` if you want the other behaviour.

## Rules that keep the feed sane

- **A missed slot is never fired late.** Anything more than
  `THREADS_LATE_GRACE_MINUTES` past its time is marked `skipped`. Coming back
  from an offline morning produces a quiet feed, not fourteen posts at once.
- **Slots already past are never scheduled.** A batch planned at 2pm starts at
  the next open slot instead of backdating the morning.
- **`published` and `failed` are terminal**, and a claim lease covers
  overlapping ticks, so no post can go out twice.
- **A reply waits for its main post** and is skipped if that post never went
  live — never orphaned into the feed on its own.

## Ownership

The app owns `data/threads-queue.json`. Everything else — the CLI, the
PowerShell task — drives it over HTTP through `/api/threads`. A second process
importing `queue.ts` would hold its own copy of the file and clobber the app's
writes, which is the same trap the Stream Pipeline had to be redesigned around.

## Setup

1. Add the Threads API use case to your Meta app with three permissions:
   `threads_basic`, `threads_content_publish`, and `threads_manage_replies` —
   the third is what `reply_to_id` needs, so without it every main post goes out
   and every reply fails.
2. Generate a long-lived token from the use case's Settings tab (User Token
   Generator → add your account as a Threads Tester, accept the invite in
   Threads, generate). The account must be public.
3. Put the numeric user id and token in `.env` as `THREADS_USER_ID` /
   `THREADS_ACCESS_TOKEN`.
4. `npm run threads:check` — confirms the token and that it belongs to that id.
5. `npm run threads:dry` — plans today's batch and reports what it would post,
   without posting.
6. `npm run threads:register` — registers the Task Scheduler entry that ticks
   every five minutes.

`npm run threads:status` shows what is scheduled and what went out.
