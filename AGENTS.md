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
