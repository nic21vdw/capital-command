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

## Environment

Copy `.env.example` to `.env` and optionally set `ALPHA_VANTAGE_API_KEY`.

## Security notes

- API keys live only in environment variables.
- Market data requests go through server-side route handlers.
- The app falls back to mock data if Alpha Vantage is unavailable.
- Secrets are never rendered in the UI and should never be logged.
- For deployment, store env vars in your platform secret manager and keep server-side write access scoped to the app data directory only.

## Scheduled publishing (YouTube Shorts · Instagram Reels · TikTok)

Finished clips can be queued with a caption and a target publish time, then
published to all three platforms — official APIs only, and runnable for $0.
Everything lives in `src/lib/publisher/` and is **off by default**: with
`PUBLISH_ENABLED` unset the clipper behaves exactly as before.

### How it works

- **Queue** — `data/publish-queue.json` (or the same JSON in your R2 bucket
  when `PUBLISH_QUEUE_BACKEND=r2`). Each item tracks the clip file, title,
  caption, hashtags, publish time, and per-platform status
  (`pending | uploaded | scheduled | published | failed`) plus post ids and
  errors. Terminal states are never reprocessed, so re-running never
  double-posts.
- **YouTube** schedules natively: the runner uploads the video as `private`
  with `status.publishAt`, and YouTube publishes it at the target time even if
  nothing else ever runs again. Each upload costs ~1600 of your 10,000 daily
  quota units (≈6 uploads/day by default).
- **Instagram and TikTok have no server-side scheduling**, so a runner wakes
  up, finds due items, and publishes them: Instagram via the create-container →
  `media_publish` flow (the video must be at a public HTTPS URL — that's what
  the R2 bucket is for), TikTok via Direct Post with `FILE_UPLOAD`.
- **Metadata** — title/description/hashtags are generated with Claude when
  `ANTHROPIC_API_KEY` is set (same as clip selection), with an offline
  fallback; anything you pass explicitly wins.
- All times you type are interpreted in `PUBLISH_TIMEZONE`
  (default `America/Toronto`).

### Ways to run it

```bash
npm run publish:dry                      # validate auth + print the plan, post NOTHING
npm run publish:run                      # process everything due right now
npm run publish:scheduler                # keep checking every 5 min while your PC is on
npm run publish:enqueue -- --clip data/clips/outputs/<job>/export-abc.mp4 --at "2026-07-10T18:30"
npm run publish:list                     # queue + per-platform status
```

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
3. Credentials → Create credentials → OAuth client ID → **Desktop app** →
   copy `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` into `.env`.
4. Mint a refresh token with the `https://www.googleapis.com/auth/youtube.upload`
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
5. Run `npm run publish:run` again — everything reports "no due items";
   nothing double-posts.
6. For GitHub Actions: add the repo secrets listed in
   `.github/workflows/publish.yml`, set `PUBLISH_QUEUE_BACKEND=r2` locally,
   enqueue, then trigger the workflow manually from the Actions tab with
   "dry run" first.

## Disclaimer

This app is for personal tracking and educational organization only. It does not provide financial, tax, legal, or investment advice.
