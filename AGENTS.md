# capital-command — how work reaches the app

Capital Command is not a launched product. It is one person's private,
local command centre for running their own social media, and the copy in
`C:\Users\nic21\OneDrive\Documents\GitHub\capital-command` is that live
system: the Windows scheduled tasks, the `.env`, the tokens and the whole
`data\` folder (publish queue, Threads queue, clips, pipeline runs) live in
that folder and nowhere else.

That is why the rules below exist. A change made directly in that folder
doesn't wait to be reviewed — it lands in the middle of a posting day.

Subsystem conventions (pipeline, threads, clips, carousels, Remotion, …) are
in `CLAUDE.md`. This file covers how a change gets from an idea into the
running app.

## Two lanes

| | Production | Sandbox |
|---|---|---|
| Folder | `…\OneDrive\Documents\GitHub\capital-command` | `%USERPROFILE%\capital-command-dev` |
| Branch | `main`, always | `dev` |
| Port | 3000 | 3100 (`npm run dev:sandbox`) |
| Data | the real queues, tokens and clips | its own empty `data\` + a snapshot of app data |
| Scheduled tasks | publish runner, Threads autopilot, channel scan, TikTok audit watch | none |
| Who edits it | nobody | every change |

The sandbox is a git worktree, so it shares the same repository and branches
without being the same working directory. Every data path in the app is
resolved from the working directory (`process.cwd()`), which is what makes
the isolation real: nothing run in the sandbox can post as Nic or touch the
live queues.

Create or refresh it with `npm run dev:worktree`.

## The loop

1. Branch off `dev` in the sandbox: `claude/<short-kebab-slug>`.
2. Make the change, verify it (`npm run typecheck`, `npm test`), open a PR
   **into `dev`**, merge it.
3. `dev` accumulates the day's work. Nothing on it touches the running app.
4. When a batch is ready to use for real, open a PR from `dev` into `main`
   and merge it. That is the release.
5. In the production folder, double-click **`update-capital-command.bat`**
   (or `npm run app:update`). It fetches `main`, installs, rebuilds and
   restarts the server. That — and only that — is when the running app
   changes.

`update-app.ps1` refuses to run if the production checkout is ahead of
`main` or has uncommitted edits, so an update can never silently discard
work that never made it into a pull request.

## Rules for agents

- **Never edit, commit, checkout or rebuild inside the production folder.**
  Its only job is to sit on `main` and run. If a session starts there, move
  to the sandbox (`%USERPROFILE%\capital-command-dev`) or a fresh worktree
  before touching a file.
- **PRs target `dev`, not `main`.** The only PR into `main` is the release
  PR from `dev`.
- **Don't register scheduled tasks from the sandbox.** `npm run
  publish:register`, `threads:register` and `tiktok:watch:register` point
  Task Scheduler at whatever folder they run in; run them in production
  only, and only when the task itself changed.
- Don't run publishing CLIs (`publish:run`, `threads:tick`, `ingest:scan`)
  in the sandbox against real tokens. The sandbox has no queues by design —
  keep it that way.

## Opening production as a desktop app

`Capital Command.bat` in the production folder starts the server if it isn't
up and opens the app in a windowed browser — no tabs, no address bar, its own
taskbar entry. `npm run app:shortcut` puts it on the Desktop and Start Menu
with the icon; Chrome will also offer "Install Capital Command" because
`src/app/manifest.ts` declares it installable.

Closing the window does NOT stop the server, and must not: the publish runner
and the Threads autopilot post through it all day whether or not anything is
on screen.

Run `app:shortcut` from the PRODUCTION folder only. Like the scheduled-task
registrations, it points at whatever checkout it runs in — from the sandbox it
would put a shortcut to port 3000 on your desktop that starts the wrong copy.

## Never relocate the build cache outside a synced folder

`scripts/prepare-dev-cache.mjs` moves `.next` out of OneDrive, because
OneDrive locks build output mid-write. It does that ONLY for checkouts inside
OneDrive, and that restriction is load-bearing: code emitted under the temp
cache resolves its dependencies from that folder's parents, so a shared
`node_modules` link there puts two copies of React in one bundle. That
prerenders as `Cannot read properties of null (reading 'useContext')` on
`/404`, and a build that survives it serves a page whose client never
hydrates — the app renders and no button works.

If you touch that script: the dependency link must stay per-checkout, and a
sibling of the relocated `.next` rather than a child, because `next build`
empties `.next` before it starts.

## Tests

`npm test` is the suite (`vitest run`). It used to be a PowerShell script that
compiled and ran a single file, which is how a green `npm test` sat next to a
dozen failures for so long.

It is hermetic, and has to stay that way — it used to read the live tokens
of whichever checkout it ran in, and asserted against a real YouTube refresh
token. `vitest.setup.ts` holds the three seams:

- **Data.** Every path into `data\` goes through `dataPath()` /
  `dataRoot()` (`src/lib/paths.ts`), which the setup points at a fresh temp
  directory. New code that touches `data\` must use that helper, not
  `path.join(process.cwd(), "data", …)`. Miss it and the test reads the
  running app's queues; `dataRoot()` throws under vitest if the override is
  ever lost, so the failure is loud rather than silent.
- **Environment.** Every app-owned variable (`YOUTUBE_*`, `TIKTOK_*`, `IG_*`,
  `FB_*`, `THREADS_*`, `PUBLISH_*`, `S3_*`, model keys …) is deleted before
  the suite runs. A test that needs one sets it with `vi.stubEnv`.
- **Timezone.** Pinned to `America/Toronto`. The Execution dashboard works in
  local dates, so a fixture written as midnight UTC lands on the previous day
  here. Write fixture timestamps at midday.
