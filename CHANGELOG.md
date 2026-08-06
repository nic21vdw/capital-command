# Changelog

What each release brought into the running app. Newest first.

A "release" is one run of `update-capital-command.bat` (or the app's own
**Install and restart**): it brings the running app up to what has landed on
`main`, rebuilds, and restarts the server. Until you run it, nothing here has
reached the app you use — that is the whole point of the split.

Every change made in the sandbox adds a line under **Unreleased** before it is
committed. The release moves that block under a dated heading — `update-app.ps1`
does that itself, so this file can never claim something is waiting that has
already shipped.

## Unreleased

- **Carousel slides now sit on the bit of the stream they are actually about.**
  The stills used to be taken at fixed intervals, so a slide about the agent
  terminal could land on a YouTube analytics page. The copy is now written
  first, from a timestamped transcript of the whole recording, and each slide
  says which second it came from — the still is cut there.
- **And the still is checked before it is used.** Each candidate is shown to a
  vision model with the slide's words; if nothing near that moment actually
  shows what the slide says, the slide is left plain rather than given a picture
  that contradicts it. This uses your existing `FAL_KEY` and costs a fraction of
  a cent per slide; without a key the stills are still anchored, just unchecked.
- **The update really does update now, and it says so the whole way through.**
  Driving it end to end on a real copy of the app turned up four more ways it
  could stop dead: a successful build reported as a failure (so the app was
  left down after a build that worked), `npm install` stripping out the tools
  the build needs, the release hanging at the last step with the app already
  back up, and any unexpected error killing it silently mid-step. A release now
  runs merge -> changelog -> install -> stop -> build -> start -> answer, shows
  the step it is on with how long it has taken, and finishes by saying the app
  is running. A warm one takes about a minute and a half.

- **A failed update can be tried again.** The app used to refuse every retry
  with "an update is already running" for as long as it stayed up, because the
  flag saying so was only ever cleared by the update restarting the server -
  which is exactly what a failed one does not do.

- **When an update stops, it tells you why in a whole sentence.** The reason
  was being cut off at its first line, mid-word.

- **Clips are framed on you now, not shrunk into a blur.** Every generated
  short used to be the whole widescreen recording squeezed into the middle of
  a 9:16 frame with a blurred fill around it — a small screenshot on a phone.
  The Clip Generator now finds you in each clip and fills the frame with you:
  when you carry the shot it crops in on you full-bleed and pans as you move,
  and when you are a small camera on a screenshare it leads with the camera —
  blown up and centred on where you actually are — keeping the screen as a
  banner above it. Clips that get this say so on the card. "Frame on the
  speaker" on the upload panel turns it off if you ever want the old crop.

- **"Frame on the speaker" in the Clip Editor.** One button in the Layout
  panel finds you in the clip you have open and sets the crop and zoom to
  match, so the preview and the export show the same framing the generator
  would have picked.

- **The update button actually updates now.** "Install and restart" has been
  starting nothing at all: the way the app launched the release script meant
  PowerShell exited immediately without running a line of it, so the app said
  it was updating, the log file stayed empty, and nothing ever changed. It is
  launched a different way, it writes a real log, and the banner shows the step
  it is on — merging, installing, building, waiting for the app — plus the
  reason in plain words if it stops.

- **Double-clicking `update-capital-command.bat` releases what is actually
  waiting.** It was still releasing the old `dev` branch, which has been behind
  for six releases and no longer merges cleanly, so a double-click ended in
  "does not merge cleanly" and changed nothing. It releases `main` — where work
  now lands — and simply rebuilds when there is nothing to merge.

- **An update no longer needs GitHub.** Fetching and uploading are best effort
  from end to end: the app compares the running build against the copy of
  `main` on this machine when GitHub can't be reached, and the release runs to
  the end with the network unplugged. A branch that never uploaded can be
  released straight from the sandbox with
  `.\scripts\update-app.ps1 -Branch claude/<name>`.

- **Updates are quicker, and a bad build no longer leaves the app down.**
  `npm install` is skipped when nothing in `package-lock.json` moved (it ran
  every time, with the app stopped, to do nothing), and a build that fails on a
  stale cache is retried once from cold — the failure that used to end a
  release with the server never coming back up.

- **The Long-Form Editor's project list is 100× lighter.** Opening `/longform`
  pulled down every project in full — transcript, silence ranges, segment plan
  and caption track for all 25 of them, 6.4 MB — to draw a row of cards that
  show a name, a status and a runtime. The list now carries the cards' own
  fields plus that runtime as a number, and the project you open is fetched
  whole on its own. On a real project the list row went from 139 KB to 3.4 KB.

- **The Clip Generator stops shipping a megabyte and a half every two
  seconds.** While a stream is being clipped, the page asks for the job list
  every 2.5 seconds — and 83% of that answer was the raw silence ranges
  detected in every stream you have ever clipped, which no list on screen
  draws. They now come with the clip you actually open, alongside its
  transcript, the same way transcripts were already handled. The list drops
  from about 1.6 MB to 0.3 MB a poll.

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

## 2026-08-03

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


- **You can talk to Capital Command for nothing.** A "Talk to it" card on
  `/agents`: click the mic, say "check my channel for anything new", and it
  answers out loud — running on the free keyless model the app already used, so
  no vendor account, no key and no bill. Arm it and it can take a stream into
  the pipeline while you listen. Publishing, scheduling, deletes and tokens are
  still not tools it has.

## 2026-08-03

- **Grok voice runs on your SuperGrok subscription, not an API bill.** The voice
  console signs in with SuperGrok / X Premium (a code you approve at
  accounts.x.ai, or one click to adopt the Grok CLI sign-in already on this
  machine) and the session is billed against that subscription. An API key is
  only the fallback now. OpenAI has no equivalent — ChatGPT Plus does not cover
  its realtime API — so Grok is the default.

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
