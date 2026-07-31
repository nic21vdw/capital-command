# Threads autopilot

One batch of posts a day, written and sent without anyone opening the app.

This replaces the old routine — generate 24 posts, then schedule and upload
them by hand through a browser agent. The pack is the same one the Threads
Engine page writes; the difference is that it now lands on a queue and posts
itself.

## The loop

`threadsTick()` (`daily.ts`) is the only entry point the scheduler needs, and
it does two things:

1. **Plan** — if today's batch isn't on the queue yet, get today's pack
   (`ensureDailyPack`, which generates it through DeepSeek on the first ask of
   the day and caches it in the app data store), and turn every slot into one
   queue item per connected account. Idempotent behind a batch-date check, so
   calling it every five minutes plans exactly once a day.
2. **Run** — post everything whose time has come (`runner.ts`).

Both steps are safe to repeat, which is the whole design: the scheduled task
is dumb and frequent, and the idempotency lives here.

## The two buttons

The dashboard (`/x-posts`) is deliberately just two:

- **Generate 24** writes a fresh day of posts against the positioning brief.
- **Schedule from now** (`POST /api/threads {action:"schedule-now"}`) hands that
  pack to the queue starting one minute after the press, keeping the pack's own
  rhythm but tightening it — never below `MIN_GAP_MINUTES` — so the last post
  still lands before midnight. Whatever won't fit is dropped rather than spilling
  into tomorrow, where it would collide with tomorrow's batch.

Two rules make that button safe to press at any hour, more than once:

- It replaces only what is still **pending**. Slots that have already gone out
  keep their place in history and are left out of the new layout, so pressing it
  at noon can't put the morning's posts back through the feed.
- It reuses today's pack. Only **Generate 24** pays for a new one.

The scheduled tick still plans an unattended day on its own; pressing the button
just re-lays the rest of the day from now.

## Two accounts, one version each

The pack deliberately writes each idea twice — a punchier `text` and a warmer
`threadsVariant` — so that two feeds carrying the same ideas never read as
duplicates. Each connected account is assigned one of those versions
(`THREADS_POSTS` / `THREADS_POSTS_2`), and posts it at the slot time plus its
own offset, so the two accounts don't fire in perfect lockstep.

Connect one account and it posts its version only — for a Threads-only setup
that should be `variant`, the copy written for Threads. `unassignedVersions()`
reports a version nobody posts ONLY when a second slot was started and left
unusable; a deliberate single-account setup leaves the other version unused by
design and shouldn't nag about it on every tick.

A slot is judged past or future by its **own** time, not each account's
offset — so a slot is always scheduled for every account or for none, and the
two feeds can't drift apart at the edges of the day.

## Rules that keep the feed sane

- **A missed slot is never fired late.** Anything more than
  `THREADS_LATE_GRACE_MINUTES` past its time is marked `skipped`. Coming back
  from an offline morning produces a quiet feed, not fourteen posts at once.
- **Slots already past are never scheduled.** A batch planned at 2pm starts at
  the next open slot instead of backdating the morning.
- **`published` and `failed` are terminal**, and a claim lease covers
  overlapping ticks, so no post can go out twice.
- **Accounts fail independently.** One expired token fails only its own half
  of the day; the other account keeps posting. An account removed from `.env`
  has its queued posts skipped rather than left pending forever.

## Ownership

The app owns `data/threads-queue.json`. Everything else — the CLI, the
PowerShell task — drives it over HTTP through `/api/threads`. A second process
importing `queue.ts` would hold its own copy of the file and clobber the app's
writes, which is the same trap the Stream Pipeline had to be redesigned around.

Tokens never leave the server: `GET /api/threads` reports each account's id,
label, assigned version and offset, and nothing else.

## Setup

1. Add the Threads API use case to your Meta app with `threads_basic` and
   `threads_content_publish`.
2. App roles → Add People → **Threads Tester** for each account, then accept
   each invite from that account (Threads → Settings → Website permissions →
   Invites). Being an app Administrator does not cover this, and each account
   must be public.
3. Generate a long-lived token per account from the use case's Settings tab
   (User Token Generator).
4. Paste each token into `THREADS_ACCESS_TOKEN` / `THREADS_ACCESS_TOKEN_2`.
   The numeric user id is optional — `accountUserId()` resolves it from the
   token once per process, because Meta hands you a token and then makes you
   go hunting for the matching id.
5. `npm run threads:check` — confirms each token and that it belongs to its id.
6. `npm run threads:dry` — plans today's batch and reports what each account
   would post, without posting.
7. `npm run threads:register` — registers the Task Scheduler entry that ticks
   every five minutes.
