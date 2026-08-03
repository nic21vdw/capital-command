# Changelog

What each release brought into the running app. Newest first.

A "release" is one run of `update-capital-command.bat`: it merges `dev` into
`main`, rebuilds, and restarts the server. Until you run it, nothing here has
reached the app you use — that is the whole point of the split.

Every change made in the sandbox adds a line under **Unreleased** before it is
committed. The release moves that block under a dated heading — `update-app.ps1`
does that itself, so this file can never claim something is waiting that has
already shipped.

## Unreleased

- **The Uploading Center stops re-reading everything every minute.** Its
  once-a-minute refresh made five requests one after another — the clip
  library, the queue, the calendar, your connected accounts and the YouTube
  channel — and paging the calendar a fortnight repeated all five. Now the four
  that can actually change go out together, paging costs one request instead of
  five, and who each platform posts as is read once when the page opens rather
  than asked of four social networks every minute. The calendar endpoint no
  longer contacts any social network at all: it was reporting the same four
  profiles a second time, and nothing on screen had read them for a while.

- **Scheduling a Short from the editor stops making you wait.** The Schedule
  Short menu used to sit on "Finding open slots…" while it read all four social
  accounts, the quota meter and the whole YouTube channel — none of which it
  shows. It now asks for the slot grid alone, starts loading the moment your
  pointer reaches the button so the menu opens already filled, keeps what is
  already booked instead of re-reading it every time you page a fortnight, and
  serves a few-minute-old channel schedule while it refreshes behind you rather
  than making you wait for three round trips to YouTube.

- **You can talk to Capital Command.** `/agents` opens a live speech-to-speech
  session on OpenAI Realtime or Grok Voice. Say "check my channel" and it reads
  the channel and tells you what is new; say "take it in" and it puts every new
  stream through the whole Stream Pipeline while you listen — long-form edit,
  clips, podcast MP3, carousel, text posts, stopping at ready to schedule. The
  API key never reaches the browser, and publishing, scheduling, deletes and
  tokens are not tools it has.

- **Clip titles are easier to review and edit.** Clip cards give the title and
  its justification more room, with clearer spacing, more readable type, and a
  two-line title editor instead of squeezing the text into one line.

- **The app tells you when there is an update, and installs it.** A banner
  appears at the top of every screen when `dev` has work the running build does
  not, listing what is in it, with one button that runs the release and reloads
  the page when the app comes back. Until now the only way to know was to read
  this file and remember to double-click a .bat, which is why four releases'
  worth of finished work sat unshipped. It only ever appears in the real app —
  a sandbox worktree can't release — and the release itself is still one
  deliberate click.

- **"Check for updates" sits above Settings in the sidebar, and you can ask it
  whenever you like.** It says which of the two answers it has — "Up to date"
  with the build you are running, or "Update available" with the count — and
  clicking it when something is waiting opens what's new with an "Install and
  restart" button. The banner only speaks up when the app happens to notice a
  release on its own; this answers the question on demand. Both read the same
  check, so they can never disagree on screen or fetch twice.

## 2026-08-02

- **An update actually replaces the running app.** Stopping the server only
  killed the process this repo had started, so a server the publish runner had
  launched kept port 3000 and carried on serving the old build — the update
  looked like it worked and changed nothing. It now stops whatever holds the
  port.

- **Two agents can no longer trip over each other in the same folder.**
  `npm run dev:worktree -- -Name <name>` gives each session its own checkout
  and branch, and it refuses to hand over one that someone is already editing.
  (Developer-facing only — nothing changes in the app.)

- **The Stream Pipeline stops stalling, inventing and paying twice.** A run
  with no audio track, no whole-recording transcript, or a settled job with no
  moment used to sit "running" forever — one had been reading a transcript for
  five days. Those now settle or skip. A silent or music-only stream no longer
  produces six confident, schedulable posts about a stream that never happened:
  posts, carousels and visual moments require real spoken words. The same audio
  was being transcribed TWICE per run, concurrently — the most expensive thing a
  run does, doubled — and now the long-form project and the clip job share one
  transcript per source. Whisper moved off the main thread, so a half-hour
  stream no longer leaves the whole app answering nothing for fifteen minutes,
  and /pipeline responds in ~36ms warm instead of up to 6.6s. Plus loudness
  normalisation on the final mix, the hook anchored to first speech rather than
  second zero, and the redundant third copy of every clip deleted.

- **Sourceflow can now run a coordinated AI team by voice or text.** The new
  Sourceflow Agents screen sends a goal to Strategy, Research, Production and
  Operations agents through ChatGPT or Grok, combines their work into one plan,
  speaks the answer aloud, queues follow-up prompts, and keeps a durable run
  history. Agents can inspect the content workspace, but any idea save or new
  pipeline run waits in an approval inbox until Nic explicitly approves it.

- **A release actually replaces the running app.** Two bugs stopped it: the
  release script read the current branch into a variable that PowerShell treats
  as the same one as its own -Branch parameter, so it released main into main;
  and a .next link left by an older layout was reused without checking where it
  pointed, so the build wrote to one folder while its dependency link was made
  beside another and the server came up unable to find react/jsx-runtime.

- **Instagram and Facebook post clips queued before hosting was set up.** An
  item with no hosted copy could never satisfy the two platforms that pull the
  video from a URL, so it failed forever on a clip sitting right there on
  disk. It uploads the clip at post time instead.

## 2026-08-02

The evening that started with "none of the buttons are clicking".

- **Buttons work again.** The app was serving a page whose client never
  started, so the sidebar rendered but nothing responded. Two separate causes,
  both fixed: a build that put two copies of React in one bundle, and an
  11 MB payload the browser had to parse before anything became clickable.
- **Overlay pictures moved out of the app-data file.** One watermark is 476 KB
  of base64 and it was copied into all 18 clip projects that used it — 8.6 MB
  of a 12.5 MB file that gets rewritten on every save and sent to the browser
  on every page load. They live on disk now, named by content hash, so one
  watermark is one file. `/api/bootstrap` went from 11.0 MB to 2.2 MB.
- **The build stopped resolving React from other checkouts.** `.next` is only
  relocated out of OneDrive for checkouts actually inside OneDrive, and the
  dependency link it needs is per-checkout instead of shared by all fifteen
  worktrees on the machine.
- **Capital Command opens as a desktop app.** `Capital Command.bat`, a Desktop
  and Start Menu shortcut (`npm run app:shortcut`), and a web manifest so
  Chrome offers to install it properly. Closing the window leaves the server
  running, because the publish runner and Threads autopilot post through it.
- **Production and sandbox are separate copies.** The folder that runs the
  workflow stays on `main` and is never edited; work happens in
  `%USERPROFILE%\capital-command-dev` on `dev`, port 3100, with its own data
  folder and its posting credentials disarmed.
- **The test suite is hermetic.** It used to read whatever sat next to it —
  including the real YouTube refresh token, which one test asserted against.
  Data paths, environment and timezone are all pinned now. 84 files, 820 tests.
- **`npm test` runs the whole suite.** It used to compile one file and print
  "portfolio calculation tests passed", which is how a green `npm test` sat
  next to a dozen failures.
