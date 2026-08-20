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
| Folder | `…\OneDrive\Documents\GitHub\capital-command` | `%USERPROFILE%\capital-command-<name>` |
| Branch | `main`, always | `claude/<name>`, cut from `main` |
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

1. Work in your own sandbox worktree, on a branch cut from `main`.
2. Verify it: `npm run typecheck`, `npm test`.
3. Add a line to **`CHANGELOG.md`** under _Unreleased_ saying what changed in
   the terms Nic cares about — what he can now do, or what stopped being
   broken. That line is what the app shows him when it offers the update, so
   write it for him and not for a commit log.
4. Land it on `main` — a pull request you open and merge yourself. Landing on
   `main` does not change the running app; a release does, and that is his.
5. The running app notices. A banner appears at the top of every screen saying
   an update is ready, listing those changelog lines, and its **Install and
   restart** button runs the release. **Check for updates** in the sidebar,
   above Settings, asks the same question on demand and installs from the same
   button — and `update-capital-command.bat` does exactly the same thing.

`update-app.ps1` dates the Unreleased block as part of releasing, so don't
hand-move it; it will be moved for you.

**`main` is where finished work waits, not what is running.** The two are
different things and the app is careful about which it means: `next start`
serves `.next`, so the check compares the RUNNING BUILD (`.next/BUILD_COMMIT`)
against `main`. A merge that never rebuilt is still an update waiting.

**The release is his to run, never yours.** Landing work on `main` is yours;
deciding when the running app changes is his. Never run `update-app.ps1`,
`update-capital-command.bat` or `POST /api/update`.

`update-app.ps1` refuses if the production checkout has commits nothing else
does or has uncommitted edits, and backs the merge out untouched if it does not
merge cleanly — a release either happens completely or leaves the app exactly
as it was.

## GitHub is a copy, not the source

Every sandbox worktree shares the production repository. Work merged in one is
in that `.git` before anything is uploaded, and the release builds from what is
there — so **a broken or unreachable GitHub cannot stop a release**, and does
not stop the app from noticing one either. Fetching and pushing are best effort
throughout: `update-app.ps1` and `dev-worktree.ps1` carry on without them, and
the app's update check falls back from `origin/main` to the local `main`.

When GitHub is refusing uploads and work is stuck on a branch that only exists
here, it can still be released directly:

```
.\scripts\update-app.ps1 -Branch claude/<name>
```

That merges the local branch into `main`, rebuilds and restarts, exactly as a
normal release does, and pushes later if it can.

## Rules for agents

- **Never edit, commit, checkout or rebuild inside the production folder.**
  Its only job is to sit on `main` and run. If a session starts there, move
  to your own worktree before touching a file.
- **One session per checkout.** Two sessions sharing a working tree is how one
  session's `git add -A` sweeps up the other's half-finished files and commits
  them — it happened on 2026-08-02, when a pipeline merge and an unrelated
  agents feature landed on `dev` minutes apart from the same folder. Take your
  own with `npm run dev:worktree -- -Name <short-name>`, which creates
  `%USERPROFILE%\capital-command-<name>` on `claude/<name>` off `main`. The
  script refuses to hand you a checkout that already has uncommitted changes,
  and a SessionStart hook warns when you land in one.
- **Never commit or push DIRECTLY to `main`.** Work reaches it through a
  pull request you open and merge, never a push to the branch itself — and
  never from inside the production checkout.
- **Don't register scheduled tasks from the sandbox.** `npm run
  publish:register`, `threads:register` and `tiktok:watch:register` point
  Task Scheduler at whatever folder they run in; run them in production
  only, and only when the task itself changed.
- Don't run publishing CLIs (`publish:run`, `threads:tick`, `ingest:scan`)
  in the sandbox against real tokens. The sandbox has no queues by design —
  keep it that way.
- **No agent that isn't Claude Code runs anything in the production folder.**
  Not a publish CLI, not `publish:shuffle`, not a one-off script that touches
  `data\` — nothing that can mutate a queue. On 2026-08-12 a non-Claude agent
  (Grok) ran publish CLIs straight at the live folder and rewrote about 306
  publish times on the queue Nic had already read, then committed the result
  under his name, so neither the git history nor the queue said an agent had
  been there. The rules above are the whole reason this repository has a
  sandbox, and an agent that has not read them cannot be trusted with the one
  folder that posts. Give it a worktree or give it nothing.
- Every write to the publish queue is now logged to `data\publish-queue.log`
  (JSON lines: time, pid, working directory, item, file, and which entry point
  wrote it — see `src/lib/publisher/audit.ts`). If the schedule changed and
  nobody knows why, read that file FIRST; the `cwd` on each line says which
  checkout did it. It is append-only and rotates at 2 MB, and a failed write
  is only ever a warning — auditing must never be able to stop a post.

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

## The app you use is always a production build, never `next dev`

Every launcher — `Capital Command.bat`, the Desktop shortcut,
`start-capital-command.bat`, `update-app.ps1` — goes through
`scripts\start-server.ps1`, which runs `next build` and then `next start`.
Keep it that way. A dev server serving port 3000 looks identical but compiles
each screen the first time it is opened: measured on this app, a sidebar link
takes **1–4 seconds** under `next dev` against **8–32 ms** under `next start`.
"The app got slow" almost always means something started it in dev mode, or
production is down and you are looking at a sandbox on another port.

Check which is which before optimizing anything:

```
netstat -ano | findstr ":3000 .*LISTENING"    # nothing here means production is DOWN
```

`start-server.ps1` builds in the FOREGROUND and only reports success once
port 3000 answers. It has to: it used to launch a detached
`build && next start` chain whose `1>` redirect bound only to `next start`, so
build output went nowhere, the pid file recorded the `cmd.exe` wrapper, and a
failed build left `.next` with no `BUILD_ID` and the app simply down — while
`update-app.ps1` waited five minutes and pointed at a `server.err.log` that was
never written. If you touch that script, keep all three guards: the build's
output is teed to `build.log`, `BUILD_ID` is checked before the server is
launched, and the port is polled before it claims to be up.

The build runs with `$ErrorActionPreference = "Continue"`. `next build` writes
warnings to stderr, and under `Stop` PowerShell promotes each of those lines to
a terminating error — a green build would abort the script.

## Two servers can hold port 3000 at once, and the wrong one wins

This cost a day. `start-server.ps1` runs `next start --hostname 127.0.0.1`,
which binds ONLY `127.0.0.1:3000`. A second `next start` without a hostname
binds the wildcard — `0.0.0.0:3000` AND `[::]:3000` — and Windows lets both
listen, because one bind is specific and the other is not.

Windows resolves `localhost` to `::1` first, and only the wildcard server is
there. So the app window, which opens `http://localhost:3000`, talks to the
STRAY server while the tracked one sits unused on `127.0.0.1`. Measured while
this was happening: `localhost:3000` took 3.6–6.8 s a request, `127.0.0.1:3000`
took 0.06 s. It reads as "the app got slow" with nothing in the logs.

`server.pid` only ever knows about the server `start-server.ps1` launched, so
`stop-server.ps1` cannot stop the stray and `update-app.ps1` restarts around it.
Both processes also write `data\capital-command.json`, and the write queue in
`src/lib/storage/store.ts` is per-process — two of them interleave, which is a
corrupted publish queue waiting to happen, not just a slow app.

`npm start` used to create exactly this (it had no `--hostname`); it now matches
the launcher. Never start a second server in the production folder by hand.
When production feels slow, check for a duplicate FIRST:

```
netstat -ano | findstr ":3000 .*LISTENING"
```

One line is healthy. Two — a `127.0.0.1` and a `0.0.0.0`/`[::]` — is this bug;
kill the wildcard one. `start-server.ps1` now refuses to start when the port
already answers, so it will not add a second itself.

## The scheduled tasks can start a server nothing can stop

`scripts\publish-runner.ps1` and `scripts\threads-autopilot.ps1` both check
port 3000 at the top of every tick and, if nothing answers, start the app
themselves with `Start-Process npm.cmd run start`. That is deliberate — the
runner has to be able to post when the app happens to be down — but the server
it launches is NOT the one `start-server.ps1` launches, and nothing writes its
pid to `server.pid`.

So `stop-server.ps1` cannot stop it, `update-app.ps1` restarts around it, and
it survives a release: a `next start` from before the merge, holding port 3000
and serving `.next` while the release rebuilds that same folder underneath it.
That is the half-rebuilt tree — the app answers, and answers with whichever
chunks happened to survive.

If production is behaving strangely after a release, or `stop-server.ps1`
reports success while the port still answers, this is the first thing to check:

```
netstat -ano | findstr ":3000 .*LISTENING"    # compare the PID against server.pid
```

Kill THAT pid, never the image name (`node.exe` is also Nic's editors and every
other agent's dev server), then start the app the normal way. Do not "fix" the
scripts by removing the fallback without giving the server it starts the same
pid file the launcher writes.

## `next build` lints stricter than `npm run lint`

`next build` treats some `react-hooks` rules as errors that a standalone lint
run only warns about — `react-hooks/set-state-in-effect` is the one that has
bitten this repo (#290). A clean `npm run lint` and a clean `npx tsc --noEmit`
are NOT evidence that a release will build. Run `npm run build` before merging
anything that touches a component, or the next `update-capital-command.bat`
fails at the type-checking stage and leaves production with no server.

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

## "The model was unavailable or declined" means the free tier is spent

Every AI feature routes through `runAi` (`src/lib/ai/provider.ts`), which
defaults to DeepSeek Flash on `https://opencode.ai/zen/v1` — free and
**keyless**. That default is why `aiConfigured()` is true out of the box, and
it is also the trap: when the free allowance runs out the endpoint answers
**HTTP 429 `FreeUsageLimitError`**, `callDeepSeek` maps any non-OK response to
`null`, and every caller quietly falls back to its offline heuristic.

What that looks like from the outside is not an outage. It is carousels that
skip with "The model was unavailable or declined. Tried 3 times", posts that
come back as "simple announcement posts", ideas served from the template
library — all at once, across features, with nothing in `server.out.log`,
because a non-OK response is never logged. On 2026-08-19 eleven runs had been
sitting on that message for a week; the cause was the free quota, not the
prompts, the transcripts or the model.

Check it directly before touching any prompt code:

```
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://opencode.ai/zen/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-free","max_tokens":20,"messages":[{"role":"user","content":"OK"}]}'
```

`429` means spent, and no retry ladder in `runDeepSeek` will get past it.

The fix is a paid key. Nic's DeepSeek key lives in
`%USERPROFILE%\.codewhale\secrets\secrets.json` under `entries.deepseek`, and
production's `.env` now points at the paid API:

```
DEEPSEEK_API_KEY=<the key>
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

`deepseek-chat` is not a reasoning model, so it answers in `content` and the
`outOfRoom` escalation ladder simply never fires — carousels come back in about
a minute each instead of failing. `.env` is read when the server starts, so a
change there needs a restart to take effect; that restart is not a release, but
confirm `.next/BUILD_COMMIT` already equals `main` before running the launcher,
or the rebuild ships whatever is sitting merged on `main` and the release stops
being Nic's to run.


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
