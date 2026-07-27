# Nic Vandewetering

Nic Vandewetering is a personal investment dashboard MVP built with Next.js, TypeScript, Tailwind CSS, and a local JSON persistence layer. It is designed for personal tracking and organization, not financial advice or trading.

## Finance & Billing

The `/finance` route adds a Stripe-style billing dashboard plus a spend tracker:

- **Billing overview** — gross/net volume, MRR, MRR growth, active subscribers, churn, a payments breakdown bar, disputes, and high-risk payments. It reads live data from Stripe when `STRIPE_SECRET_KEY` is set (use a restricted, read-only key) and otherwise renders representative sample data so the UI always works.
- **AI & setup spending** — track one-time hardware (PC build, GPU, peripherals) and recurring AI/cloud subscriptions. Recurring costs are normalized to a monthly run rate (with simple USD↔CAD conversion) so you can see total invested, monthly burn, and annualized cost at a glance.
- **Themes** — six accent themes (Lime, Violet, Ocean, Sunset, Rose, Mono) plus light/dark mode, switchable from the Finance toolbar or Settings. Your choice persists locally and to app settings.

## Why this persistence choice

For Phase 1, the app uses a server-side JSON store instead of SQLite/Supabase/Convex. This keeps local setup to one command, avoids native database friction, and still gives us a clean repository abstraction that can be swapped for SQLite or a hosted backend later.

## Planned setup

1. Install dependencies with `pnpm install`
2. Start the app with `pnpm dev`

If you prefer npm:

1. `npm install`
2. `npm run dev`

## Local Command Dashboard Launcher

If you are not a developer and just want to open the Command Dashboard on your
own Windows PC, use the double-click launcher instead of typing commands.

### How to use the `.bat` file

1. Open the project folder in File Explorer.
2. Double-click **`launch-colateral-command-dashboard.bat`**.
3. A black Command Prompt window opens and sets everything up for you.
4. Your browser opens the dashboard at **<http://localhost:3000>**.
   (If it doesn't open on its own, type that address into your browser.)

The very first run installs the app's building blocks and can take a few
minutes. After that, launches are fast because that step is skipped.

### What command is being run behind the scenes

The launcher simply runs the project's normal startup steps for you:

- `npm install` — but **only the first time**, when the `node_modules` folder
  is missing. On later runs this is skipped.
- `npm run dev` — starts the local development server (Next.js) on port 3000.

That's the same thing a developer would type by hand; the `.bat` file just
remembers it for you.

### How to stop the server

The dashboard runs for as long as the black launcher window stays open. To
stop it, either:

- Press **Ctrl + C** inside that window, or
- Simply **close the window**.

Once it's stopped, <http://localhost:3000> will no longer load until you launch
it again.

### If the port is already in use

If you see a message like *"port 3000 is already in use"*, it usually means the
dashboard is already running in another window (or a previous run didn't fully
close). To fix it:

1. Find and close any older launcher / Command Prompt windows, then
   double-click the `.bat` again.
2. If that doesn't help, restart your PC to clear the leftover server, then
   launch again.

> Tip: there is also a `start-capital-command.bat` launcher. That one first
> downloads the latest version of the app from GitHub before starting. Use
> `launch-colateral-command-dashboard.bat` when you just want to run the copy
> already on your PC.

## Environment

Copy `.env.example` to `.env` and optionally set `ALPHA_VANTAGE_API_KEY`.

## Security notes

- API keys live only in environment variables.
- Market data requests go through server-side route handlers.
- The app falls back to mock data if Alpha Vantage is unavailable.
- Secrets are never rendered in the UI and should never be logged.
- For deployment, store env vars in your platform secret manager and keep server-side write access scoped to the app data directory only.

## Scheduled publishing (YouTube Shorts · Instagram Reels · Facebook Reels · TikTok)

Finished clips can be queued with a caption and a target publish time, then
published to all four platforms — official APIs only, and runnable for $0.
Everything lives in `src/lib/publisher/` and is **off by default**: with
`PUBLISH_ENABLED` unset the clipper behaves exactly as before.

### How it works

- **Queue** — `data/publish-queue.json` (or the same JSON in your R2 bucket
  when `PUBLISH_QUEUE_BACKEND=r2`). Each item tracks the clip file, title,
  caption, hashtags, publish time, and per-platform status
  (`pending | uploaded | scheduled | published | failed | manual`) plus post
  ids and errors. Terminal states are never reprocessed, so re-running never
  double-posts. Assigning a clip to a platform that has no credentials yet
  saves it as `manual` — an amber reminder to post by hand, never an error.
- **YouTube** schedules natively: the runner uploads the video as `private`
  with `status.publishAt`, and YouTube publishes it at the target time even if
  nothing else ever runs again. Each upload costs ~1600 of your 10,000 daily
  quota units (≈6 uploads/day by default).
- **Instagram, Facebook, and TikTok have no server-side scheduling**, so a
  runner wakes up, finds due items, and publishes them: Instagram via the
  create-container → `media_publish` flow, Facebook via the equivalent
  video_reels start → finish flow (both need the video at a public HTTPS
  URL — that's what the R2 bucket is for), TikTok via Direct Post with
  `FILE_UPLOAD`.
- **Metadata** — title/description/hashtags are generated with Claude when
  `ANTHROPIC_API_KEY` is set (same as clip selection), with an offline
  fallback; anything you pass explicitly wins.
- All times you type are interpreted in `PUBLISH_TIMEZONE`
  (default `America/Toronto`).

### Uploading Center (in-app)

The **Uploading Center** in the sidebar is the point-and-click way to drive
the queue. It lists the clips from the latest generator run with thumbnails,
lets you edit title/caption, pick a platform (YouTube · TikTok · Instagram · Facebook)
and a schedule slot — weekdays at 07:30 / 12:30 / 19:30 `PUBLISH_TIMEZONE`,
stored as UTC — or drag a clip straight onto the 14-day board. It also shows
a YouTube quota meter (uploads today vs the `YOUTUBE_DAILY_UPLOAD_BUDGET`,
default 6) and a **Connect YouTube** button: set `YOUTUBE_CLIENT_ID` /
`YOUTUBE_CLIENT_SECRET` in `.env` (OAuth client type **Web application** with
redirect URI `http://localhost:3000/api/auth/google/callback`), click
Connect, approve, done — the refresh token is stored server-side in
`data/publisher-tokens.json`, never in the browser. TikTok/Instagram/Facebook
assignments save as `manual` reminders until those APIs are connected.

### Ways to run it

```bash
npm run publish:dry                      # validate auth + print the plan, post NOTHING
npm run publish:run                      # process everything due right now
npm run publish:scheduler                # keep checking every 5 min while your PC is on
npm run publish:enqueue -- --clip data/clips/outputs/<job>/export-abc.mp4 --at "2026-07-10T18:30"
npm run publish:list                     # queue + per-platform (and Buffer) status
```

### Buffer — your social media manager

[Buffer](https://buffer.com) is an optional **delivery layer** that turns the
publisher into a hands-off social media manager. Connect your channels once
inside Buffer, and the runner schedules every due post into Buffer with its
target time; Buffer then fans it out to all connected channels and publishes at
that time — the same downtime-proof, "schedule once, publish later" model as
YouTube's native scheduling. It's the zero-API-setup path: instead of wiring up
Instagram/TikTok/Facebook tokens above, you let Buffer own those channels.

Turn it on with `BUFFER_ENABLED=true`, then set `BUFFER_ACCESS_TOKEN` and
`BUFFER_PROFILE_IDS` (see `.env.example`). Buffer runs **alongside** the direct
platforms — it has its own `buffer` state on each queued post and never touches
platform publishing — so enabling it can't break existing scheduling. It's off
by default; with it off nothing Buffer-related runs.

```bash
npm run publish:buffer:profiles          # list your connected Buffer profiles + ids
npm run publish:buffer                    # schedule every due queue item into Buffer
# (npm run publish:run also runs the Buffer pass automatically when it's enabled)
```

To avoid double-posting, let Buffer manage the channels you *don't* post to
directly and trim `PUBLISH_PLATFORMS` to only the ones with direct tokens.

Through the app (with `PUBLISH_ENABLED=true`): finished editor exports are
auto-queued when `PUBLISH_AUTO_ENQUEUE=true`, or enqueue explicitly:

```bash
curl -X POST localhost:3000/api/publish -H "Content-Type: application/json" \
  -d '{"jobId":"<jobId>","file":"export-abc.mp4","publishAt":"2026-07-10T18:30","platforms":["youtube","tiktok"]}'
curl -X POST localhost:3000/api/publish/run -d '{"dryRun":true}'
```

**Always-on for free:** `.github/workflows/publish.yml` runs `run-due` every
15 minutes on GitHub Actions using repo secrets, so scheduled Reels/TikToks
fire even when your computer is off. This requires `PUBLISH_QUEUE_BACKEND=r2`
(locally too), because the Actions runner can't see your `data/` folder — at
enqueue time the clip and the queue are pushed to the bucket. Don't run the
local scheduler and the Actions cron against the same queue at the same time.

### Platform setup

**YouTube (Data API v3)**
1. [Google Cloud Console](https://console.cloud.google.com) → new project →
   enable **YouTube Data API v3**.
2. OAuth consent screen → External → add yourself as a test user.
3. Credentials → Create credentials → OAuth client ID → **Web application**
   with authorized redirect URI
   `http://localhost:3000/api/auth/google/callback` → copy
   `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` into `.env`.
4. Easiest: click **Connect YouTube** in the Uploading Center — the refresh
   token is minted and stored server-side automatically. Alternatively mint
   one yourself with the `https://www.googleapis.com/auth/youtube.upload`
   scope (e.g. the [OAuth playground](https://developers.google.com/oauthplayground)
   with "Use your own OAuth credentials" checked) → `YOUTUBE_REFRESH_TOKEN`.

**Instagram (Graph API content publishing)**
1. Switch the Instagram account to **Business/Creator** and link it to a
   Facebook Page.
2. [developers.facebook.com](https://developers.facebook.com) → create an app →
   add the Instagram product.
3. Grant `instagram_content_publish` (plus `pages_show_list`,
   `instagram_basic`) and generate a **long-lived** access token
   → `IG_ACCESS_TOKEN`.
4. Find the numeric professional-account id → `IG_USER_ID`.
5. Configure the `S3_*` variables — Instagram downloads the video from a
   public HTTPS URL, so clips must be hosted (see R2 below).
   Note: API-published Reels are always **public**; use a test account for
   trial runs. ~50 API posts per rolling 24 h.

**Facebook (Graph API Video Reels publishing)**
1. Create (or use) a **Facebook Page**.
2. [developers.facebook.com](https://developers.facebook.com) → create an app
   (or reuse the Instagram app) → add the Facebook Login/Pages product.
3. Grant `pages_manage_posts` and `pages_read_engagement`, then generate a
   **long-lived Page access token** (not a user token) → `FB_PAGE_ACCESS_TOKEN`.
4. Find the Page id (Page → About, or `GET /me/accounts` with a user token) →
   `FB_PAGE_ID`.
5. Configure the `S3_*` variables — Facebook pulls the video from a public
   HTTPS URL (`file_url`), so clips must be hosted (see R2 below).
   Note: API-published Reels are always **public**; use a test Page for
   trial runs.

**TikTok (Content Posting API)**
1. [developers.tiktok.com](https://developers.tiktok.com) → create an app →
   add **Content Posting API** → request the `video.publish` scope.
2. Complete the OAuth flow for your account and store
   `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`.
3. **Audit gate:** until TikTok audits and approves the app, every API post is
   forced to `SELF_ONLY` (only you can see it) — that's the built-in sandbox.
   Once approved, set `TIKTOK_AUDITED=true` and posts follow your configured
   visibility (`public` → `PUBLIC_TO_EVERYONE`). No code changes needed.

**Cloudflare R2 (free media hosting)**
1. Cloudflare dashboard → R2 → create a bucket (free tier: 10 GB, zero egress
   fees).
2. "Manage R2 API tokens" → create a token with read/write on the bucket →
   `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
3. `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_BUCKET`,
   `S3_REGION=auto`. Leave `S3_PUBLIC_BASE_URL` blank to use presigned URLs
   (no public bucket needed).

### Manual test checklist (before going public)

1. Fill in `.env` (start with `PUBLISH_DEFAULT_VISIBILITY=private`).
2. `npm run publish:enqueue -- --clip <a finished clip> --at "<10 min from now>"`.
3. `npm run publish:dry` — every configured platform shows **auth ✓** and a
   payload plan with the right local/UTC time; nothing is posted.
4. `npm run publish:run` —
   - **YouTube**: video appears in YouTube Studio as **Scheduled** for the
     right time (public visibility) or as Private (private visibility).
   - **TikTok**: post appears on your profile as private (`SELF_ONLY`) and
     `publish:list` shows its post id.
   - **Instagram**: use `--visibility public` on a test account; the Reel goes
     live and `publish:list` shows the media id.
   - **Facebook**: use `--visibility public` on a test Page; the Reel goes
     live and `publish:list` shows the video id.
5. Run `npm run publish:run` again — everything reports "no due items";
   nothing double-posts.
6. For GitHub Actions: add the repo secrets listed in
   `.github/workflows/publish.yml`, set `PUBLISH_QUEUE_BACKEND=r2` locally,
   enqueue, then trigger the workflow manually from the Actions tab with
   "dry run" first.

## Threads autopilot (a fresh batch of posts every 24 hours, posted for you)

The X/Threads Post Engine already writes 24 fresh posts a day against your
positioning brief, and writes every idea **twice** — a punchier `text` and a
warmer `threadsVariant` — so two feeds never read as duplicates. The autopilot
takes it the rest of the way: each connected Threads account posts one of those
versions at its slot times, unattended. No browser agent, no copy-pasting.

With both accounts connected you get 24 posts a day on each, covering the same
ideas in genuinely different words:

```
slot 1  07:15  account 1  → the punchy version
slot 1  07:18  account 2  → the warm rewrite
```

Connect only one account and it simply posts its own version; the dashboard
tells you the other half of the pack is going unused.

**Setup, once:**

1. In your Meta app, add the **Access the Threads API** use case
   ([Meta's Threads API docs](https://developers.facebook.com/docs/threads))
   with `threads_basic` and `threads_content_publish` under *Permissions and
   features*.
2. **App roles → Add People → Threads Tester**, add each Threads account, then
   accept each invite *from that account*: Threads → Settings → **Website
   permissions** → Invites. Being an app Administrator does not cover this —
   the consent has to come from the account side, and each account must be
   public.
3. On the Threads use case's **Settings** tab, under *User Token Generator*,
   generate a long-lived token for each account.
4. In `.env`, fill in `THREADS_USER_ID` / `THREADS_ACCESS_TOKEN` for the first
   account and `THREADS_USER_ID_2` / `THREADS_ACCESS_TOKEN_2` for the second
   (the numeric id, not the @handle). Everything else has a working default —
   see `.env.example` for the full list.
5. `npm run threads:check` — confirms each token works and belongs to its id.
6. `npm run threads:dry` — plans today's batch and prints exactly what each
   account would post, without posting anything.
7. `npm run threads:register` — registers the scheduled task (every 5 minutes,
   all day). It starts the app if it isn't running, plans the day's batch once,
   and posts whatever is due. Log: `threads-autopilot.log`. Remove it again with
   `Unregister-ScheduledTask -TaskName "Capital Command threads autopilot" -Confirm:$false`.

**Day to day:** nothing. The Post Engine page (`/x-posts`) shows an autopilot
card with each account's tally, the next post time, and buttons to schedule,
post what's due, or re-check the connections by hand. `npm run threads:status`
is the same thing in a terminal.

**If your PC was off**, posts that missed their slot by more than
`THREADS_LATE_GRACE_MINUTES` (45 by default) are skipped rather than fired
late, and the next day starts fresh — so you never come back to a burst of
fourteen posts going out in one minute. One account's expired token fails only
its own half of the day. Design notes:
[`src/lib/threads/README.md`](src/lib/threads/README.md).

## Animated video segments (Remotion)

Make **dynamic animated clips** to record commentary over — title cards,
animated bullet points, counting stats — instead of static slideshows, for $0
in API fees. The animations live in `remotion/` and render locally.

- **Everyday flow:** have an idea → in Claude Code run the `/animate-video`
  skill → it renders MP4 segments into `remotion/out/` → drop them into the
  Long-Form (`/longform`) or Clips (`/editor`) timeline → record your voice-over
  → publish through the Uploading Center.
- **Preview/export by hand:** double-click **`launch-remotion-studio.bat`** to
  open Remotion Studio in your browser.
- Full plain-English walkthrough: [`docs/ANIMATED_VIDEOS.md`](docs/ANIMATED_VIDEOS.md).

Remotion is free for solo creators (and teams of 3 or fewer) —
[license](https://www.remotion.dev/docs/license).

## Disclaimer

This app is for personal tracking and educational organization only. It does not provide financial, tax, legal, or investment advice.
