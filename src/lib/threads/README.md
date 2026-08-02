# Threads autopilot

One batch of posts a day, written and sent without anyone opening the app.

This replaces the old routine — generate 24 posts, then schedule and upload
them by hand through a browser agent. The pack is the same one the Threads
Engine page writes; the difference is that it now lands on a queue and posts
itself.

## The loop

`threadsTick()` (`daily.ts`) is the only entry point the scheduler needs, and
it does four things:

1. **Plan** — if today's batch isn't on the queue yet, get today's pack
   (`ensureDailyPack`, which generates it through DeepSeek on the first ask of
   the day and caches it in the app data store), and turn every slot into one
   queue item per connected account. Idempotent behind a batch-date check, so
   calling it every five minutes plans exactly once a day.
2. **Plan ahead** — from `THREADS_PLAN_AHEAD_HOUR` (21:00 local) on, write
   **tomorrow's** batch too. Slots run round the clock, so a day planned on the
   day itself arrives with its early hours already gone: planning at 07:00
   drops every slot before it. Tomorrow has to be on the queue before midnight
   or the small hours are lost every single day.
3. **Catch up** — if today fell behind, re-lay what is left of it across the
   time that remains (below).
4. **Run** — post everything whose time has come (`runner.ts`).

Every step is safe to repeat, which is the whole design: the scheduled task is
dumb and frequent, and the idempotency lives here.

## Round the clock

The day's slots are spread across the **whole 24 hours** — a pack of 24 lands
roughly one post an hour, through the night as well as the day. That is a
deliberate reading of the ceiling: Threads allows **250 API-published posts per
profile per 24-hour rolling window**, so 24 is about a tenth of what the API
permits and the real limit is what a feed will tolerate, not what Meta will
accept.

`scheduleWindow()` in `src/lib/x-posts/generator.ts` owns that window. Pull it
back to waking hours with `THREADS_DAY_START` / `THREADS_DAY_END` ("HH:MM")
if the overnight posts aren't earning their place; a window that ends before it
starts is read as "to the end of the day" rather than wrapping past midnight,
which would put later slots on the next calendar day while still carrying
today's batch date.

## Catching up on a day that fell behind

The machine was off, or the app wouldn't start, and the slots that came due
meanwhile were skipped — correctly, because firing them late all at once is the
one thing this design refuses to do. But stopping there means a day that
quietly delivers four posts instead of twenty-four, which misses the point of
an autopilot.

So `catchUpToday()` re-lays what is left across the time that remains: the
dashboard's **Schedule from now** button, pressed automatically. It is fenced in
on four sides so it can never become the burst it exists to avoid:

- **A wide floor on the spacing.** Catch-up passes
  `THREADS_CATCHUP_GAP_MINUTES` (20) as the minimum gap instead of the button's
  `MIN_GAP_MINUTES` (5), and whatever doesn't fit at that spacing is **dropped**,
  not crammed in. Recovering a lost morning is not a licence to empty twelve
  posts into the feed in an hour.
- **A cooldown** (`THREADS_CATCHUP_COOLDOWN_MINUTES`, 60), so a day with
  genuinely no room left doesn't churn its own queue every five minutes.
- **A shortfall threshold** (`THREADS_CATCHUP_MIN_SHORTFALL`, 2) — one lost slot
  isn't worth rewriting the day for.
- **Published slots keep their place.** They are held out of the new layout, so
  a catch-up can never put an idea through the feed twice.

A day with nothing on the queue at all is not "behind", it is unplanned — that
belongs to step 1, and catch-up leaves it alone. Switch the whole thing off with
`THREADS_CATCHUP=false`.

## How the posts have to read

Nobody types an em dash on a phone. Models reach for one constantly, so it is
the clearest sign a feed is automated — and asking the model not to only works
for a few posts before it drifts back. `src/lib/x-posts/voice.ts` is what makes
it true instead of merely requested:

- `stripDashes` is deterministic and runs over **every** post, whatever wrote
  it: the model, the fallback idea library, or a hand edit from the dashboard.
  A punctuation dash becomes a comma, which is what someone typing fast would
  have written, comma splice and all. Line breaks survive, because collapsing a
  four-line post into a paragraph is a bigger tell than the dash was.
- It runs twice on purpose — at pack build and again in `fitToThreads`, the last
  gate before anything is queued. Stripping is idempotent, so that costs
  nothing.
- `sprinkleTypo` drops the apostrophe from one contraction on a small share of
  posts (`THREADS_TYPO_RATE`, default 0.08; set 0 to switch it off). Seeded off
  the post, so a replan never rewrites it, and it runs ONLY at pack build — put
  it in `fitToThreads` and a post would collect a fresh slip every catch-up.
- It touches contractions only, never a noun and never a brand: a misspelled
  product or platform name reads as careless about the thing being sold, where
  "dont" just reads like a person.

The prompt asks for the same voice — no dashes, no "it's not X, it's Y", plain
words, hard-varied sentence length — so most posts arrive clean and the pass is
the backstop rather than the whole mechanism.

## Threads cannot schedule, so something must be online

Worth stating plainly, because it is the first idea everyone has: **the Threads
API has no scheduled publishing.** There is no `scheduled_publish_time`, no
future-dated container — a post exists the moment `threads_publish` is called.
Handing Threads a day's worth of posts in the morning and walking away is not
possible, and no amount of work on this module will make it so. Every product
that offers "Threads scheduling" is holding your content on its own servers and
calling the API at the minute.

That leaves exactly three ways to run a day, and it is worth knowing which one
you are on:

1. **This machine, during a window.** Slots are confined to waking hours
   (`THREADS_DAY_START` / `THREADS_DAY_END`) so the host can be switched off
   overnight. Free, and what this repo does today.
2. **This machine, round the clock.** Leave the window unset and keep the host
   awake — the fullest reach, at the cost of an always-on desktop.
3. **Hand off to something always-on.** `src/lib/publisher/buffer.ts` already
   does this for the publish queue: push a post once with a future
   `scheduled_at` and let Buffer fire it. Wiring the Threads autopilot into that
   is the only way to get overnight posts with the host switched off. Buffer's
   free tier holds 10 queued posts per channel, so a 24-post day needs a paid
   plan.

## The posting window and the end of the day

With a window configured, it is not only the pack's slots that respect it —
`endOfPostingDay` makes the start-now layout (and so the automatic catch-up)
stop at the window's end rather than at midnight. Re-laying a missed morning
across a 07:00-23:00 day must not park posts at 23:45, after the machine is
switched off: they would never fire, and the day would report itself recovered
when it wasn't.

Only an **explicitly set** `THREADS_DAY_END` shortens the day. The default
window ends at 23:20 purely so the last slot isn't pinned to midnight, and
reading that as a curfew would quietly truncate every start-now batch.

## Keeping the machine awake (round-the-clock only)

Nothing local posts while Windows is asleep, and catch-up cannot rescue hours
that have already gone — only the rest of the day once the machine wakes. A
default Balanced power plan sleeps after 30 minutes idle, which is enough to
lose most of a round-the-clock day and was exactly how one day here delivered 7
posts out of 24.

The scheduled task cannot solve this itself. `WakeToRun` sounds like the answer,
but the task repeats every five minutes: the machine would wake every five
minutes all night and never meaningfully sleep, paying an awake machine's power
for a sleeping one's reliability.

So the host stays awake instead — display off, machine on:

    powercfg /change standby-timeout-ac 0
    powercfg /change standby-timeout-dc 0
    powercfg /change hibernate-timeout-ac 0
    powercfg /change hibernate-timeout-dc 0

`npm run threads:register` checks this and warns when a sleep timeout would eat
the overnight batch. A Windows feature update or a power-plan reset silently
puts the timeouts back, and the symptom — a day that quietly delivers half its
posts — looks like nothing more than a quiet feed, so it is worth re-checking
whenever the count drops.

Wanting the machine to sleep anyway means moving the app and this task to an
always-on host; there is no local arrangement that gets both.

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
  Catch-up doesn't bend this: it gives those ideas a **new, future** slot at a
  wide spacing, which is a re-layout, not a late firing.
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
