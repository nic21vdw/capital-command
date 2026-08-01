# Launch Pad (`src/lib/launch`)

Planning and tracking for a Product Hunt launch, surfaced at `/launch`.

## What this can and cannot do

Product Hunt's v2 API is **read-only for anything that matters here**. There is
no public write API for creating a launch, so nothing in this module publishes.
Submitting the listing, uploading the gallery, and posting the maker comment are
manual steps by design — the module's job is to make sure the right thing is
ready at the right time, and to read the standing back once the listing is up.

## The three pieces

**`playbook.ts`** — `LAUNCH_PLAYBOOK` is a template of tasks carrying an
`offsetDays` relative to launch day; `buildLaunchPlan(launch, today)` dates them
backwards from `launch.launchDate` and merges in `launch.completedTasks`. The
plan is derived, never stored, so editing the playbook updates every launch and
moving the launch date moves the whole schedule with it. Only the set of
completed task ids is persisted.

**`copy.ts`** — writes the listing kit (tagline, description, maker's first
comment, topics, gallery order, launch-day social posts) through `runAi`,
reusing `CHANNEL_KEYWORDS` so the social posts share the channel's voice. Same
prompt / parse / fallback split as `publisher/ai-copy.ts`: `generateLaunchCopy`
never throws, falling back to a deterministic draft when no provider answers.
The tagline is truncated to 60 characters because Product Hunt cuts it there.

**`producthunt.ts`** — reads live stats off the GraphQL API with a developer
token in `PRODUCT_HUNT_TOKEN`. Product Hunt exposes no rank field, so the
standing is read off the day's vote-ordered leaderboard and comes back `null`
rather than wrong when the launch is outside the top 20. Everything else on the
page works without a token.

## Storage

Launches live in the app data store (`productLaunches` on `AppData`) and are
written through `/api/data` like every other collection — no separate JSON file,
so none of the single-process ownership traps that apply to the Stream Pipeline
and Threads autopilot apply here. `/api/launch` only generates copy and reads
Product Hunt; it never writes.
