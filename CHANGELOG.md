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

- **TikTok shows its real profile picture again.** The Connect badge and the
  sidebar used to keep a signed CDN URL that dies after a couple of days, so
  the face went blank until you reconnected. The app now keeps a local copy
  of the photo and refreshes it on its own.

## 2026-08-10

- **A booking alarm now goes out on its own once you have fixed the cause.**
  Turn publishing back on, or free up a slot, and the next heartbeat books the
  outputs and clears the badge, the "not scheduled" label and the amber
  Scheduler row without you touching anything. They used to stay lit forever,
  and the only button offered answered "nothing on this run is waiting".
- **A failure you have decided to live with can be put down.** Every flagged
  run has a **Dismiss** next to the retry. It clears the flag; if the same
  thing fails again on the next pass it is flagged again.
- **A run where NOTHING could be booked now says "Nothing on this run could be
  booked" rather than "1 output could not be booked"** — it was sending you
  looking for the other outputs that were supposedly fine.
- **One booking button instead of two identical ones.** "Book these now" and
  "Schedule everything from this run" opened the same sheet side by side.
- **The blocker in the booking sheet now links to Settings**, like the
  Scheduler row does — you could read why nothing could be booked with no way
  out of it.
- **The overnight scan report says what actually happened.** It used to end
  every line with "ready to schedule" even for runs that had already booked
  themselves into the publish queue.
- **A run that could book NOTHING at all now says so.** An unattended stream
  that finished while publishing was off used to read green and quietly book
  nothing — it now raises the same amber badge and "not scheduled" label as a
  single failed output, with the reason and a link straight to Settings.
- **The publishing switch in Settings takes effect on screen the moment you
  click it.** It used to spring back to its old position, and the warning about
  why nothing could be booked never appeared until the next reload.
- **Nothing tells you to edit `.env` and restart any more.** Every screen and
  error that used to say "set PUBLISH_ENABLED=true in .env" now says publishing
  is switched off and links to Settings.
- **A Threads post the app could not schedule offers to schedule the posts**,
  rather than opening the video booking sheet that cannot fix it.
- **The nightly scan no longer claims nothing is published.** The scan script,
  the voice assistant and the Channel ingest panel all say it stops at "ready to
  schedule" unless overnight scheduling is on, in which case the run books its
  own outputs.
- **Publishing is a switch in Settings now, not a line in a file.** Turning the
  app's posting on or off — and seeing why an overnight run would book nothing
  — no longer means editing `.env` and restarting.
- **An output that could not be scheduled can no longer read as "Finished".**
  It counts in the sidebar and the run says how many were not scheduled.
- **A stream taken in overnight renders its topic segments whichever way the
  scheduling switch is set.** They are videos you already own; only the
  scheduling waits for your say-so.
- **A Threads post the app failed to schedule overnight is reported**, instead
  of failing silently every few minutes forever.
- **The Agents panel and the Stream Pipeline agree about the nightly scan.**
  The panel could say "nothing taken in yet" while the pipeline said the task
  had not run for days.

- **A nightly scan that never ran is now visible.** A scheduled task switched
  off, or a machine asleep, used to look exactly like a healthy scan: the last
  success sat there forever while nothing came in. After a day and a half with
  no scan the app says so and offers **Scan now** — which is also offered in
  every other scan state, so reconnecting the channel clears the notice
  immediately instead of tomorrow.
- **An output the app failed to book no longer disappears.** The automatic
  booking discarded its failures, so the Scheduler still said "ready to
  schedule" for something it had quietly given up on; it now says what could not
  be booked and why, with a button to try again.

- **Overnight scheduling is now yours to switch on, and it is off.** A stream
  taken in overnight was booking itself into the upload and Threads queues —
  which post at their slots, with titles and copy written by AI you had not
  read. Settings has one switch for it; with it off the scan does everything
  else and leaves the scheduling to you, which is what the docs always said.

- **A channel scan that fails overnight finally tells you.** The nightly scan
  runs as its own process, so nothing it did survived into the app — a failed
  scan, a disconnected channel or a token that needs reconnecting was silent
  until you noticed nothing had come in for days. The outcome is written down
  now, counted in the sidebar, and said on the Stream Pipeline with **Scan
  again** and a link to reconnect.
- **A stream taken in overnight renders its segments and schedules its Threads
  posts too**, not just its videos — the two clicks that were left.
- **A corrupt data file is now one button to recover from.** Every save keeps a
  verified copy of your document (the last three, in `data\snapshots`), so when
  the app cannot read `capital-command.json` the screen that says so offers
  **Restore the last good copy** — it tells you what it is about to replace and
  when the copy is from, and puts your holdings, carousels, content and settings
  straight back. No more remembering to run `backup-to-drive.bat`.
- **The wording no longer points you at the broken file.** The
  `.unreadable-…` copy saved beside your document is a copy of the DAMAGED file
  — evidence to look at, not a backup to restore — and the screen now says that.
- **A second corruption gets its own copy.** Whatever went wrong the first time,
  the next incident used to get no copy at all and the message named the old
  one's file.
- **An unreadable data file says so instead of looking like a brand-new app.**
  Every screen used to render empty, down to a "set up your profile" prompt.
  And only one copy of a corrupt file is kept, not one per page load.

- **A data file that cannot be read is never replaced any more.** One field the
  app did not recognise used to hand it demo data AND write that over your
  document — every carousel, holding and content item gone, silently. It now
  refuses to serve, keeps the file exactly as it is, saves a copy next to it and
  says so.
- **A stream taken in overnight schedules itself.** The nightly scan's runs now
  book their outputs as each one finishes, so you review a scheduled run instead
  of starting the scheduling. The Scheduler row still has the button to stop it.
- **An output you held back opens unticked, and stays held back.** The sheet
  said "tick it to book it" next to a box that was already ticked, so pressing
  Schedule re-booked exactly what you had kept back.
- **A failed overnight channel scan now shows up in the count**, instead of only
  on the Agents screen.
- **A scheduled carousel links to the Uploading Center**, where its retry,
  remove and slide files actually are.
- **A sandbox can no longer write to the live storage bucket.** The bucket keys
  are stripped from a sandbox's settings, like the posting tokens already were.

- **A story-shaped deck says so instead of failing at its slot.** Instagram only
  takes pictures between 4:5 and 1.91:1, so a 9:16 carousel could be booked and
  then rejected hours later; it is now left out of the booking with the reason
  and the frames that would work.

- **A booked carousel is now a deck Instagram will actually accept.** The slides
  were being painted as PNGs — the one format Instagram refuses — so every
  carousel the pipeline booked could only fail at its slot, hours after you
  could do anything about it. They are JPEGs now, and a landscape deck renders
  at 1440px wide instead of 1920, which is the other thing Instagram turns down.
  Decks painted the old way repaint themselves and their leftovers are cleaned up.
- **A picture post with nothing connected is no longer a dead end.** The card in
  the Uploading Center shows the first slide, says how many there are, and opens
  or downloads any of them — so "post this by hand" means clicking a number,
  not going looking under `data\` for files you were never told about. The
  reminder itself stopped calling a carousel a clip.
- **The podcast feed's public address is set on the Podcast page now, not in a
  text editor.** The Feed URL card takes the bucket's public address, checks it
  is something Spotify can actually fetch from (https, no login in the URL, not
  localhost) and starts using it on the spot — no `.env`, no restart. Every
  stream whose episode got skipped for "nowhere public to live" can then be
  added under **Publish an episode**, and **Change address** is there if the
  bucket ever moves.
- **A booked carousel shows up under Carousels on the Master Calendar**, not
  under Shorts where you would never look for it.

- **An output you held back can be booked later.** The sheet listed it, ticked
  it, and then refused with "nothing is waiting to be scheduled" — the only way
  out was editing a file. It is now listed unticked and says why; ticking it
  books it.
- **The last thing a run makes gets booked too.** The tick that finished a run
  turned the automatic booking off before it had booked that final segment.

- **"Schedule everything from this run" now includes the carousel.** The deck is
  painted to real slides on disk and booked as one picture post alongside
  the shorts and the long-form video — same tick box, same free slot, nothing
  posted early. It only paints what changed, so re-opening the plan sheet or
  leaving the standing instruction running costs nothing.
- **The Scheduler row stopped saying "carousel to post by hand"**, because it
  isn't any more. It says how many slides are ready to book, and only calls a
  deck out as handwork when it is longer than the ten pictures one post can
  carry. The visual ad is still yours to compose — it is a prompt and a frame
  you choose, not a file the app has made.
- **Pictures can be scheduled now, not just video.** The publish queue takes an
  image post — one picture or a whole carousel deck, in order — and posts it to
  Instagram and Facebook at its slot, the same way a clip goes out. A deck lands
  as a real Instagram carousel and as one Facebook post with every photo
  attached, so the carousels and visual ads no longer have to be exported,
  downloaded and posted by hand.
- **A picture post that a network can't take is refused when you book it**, with
  the reason — YouTube has no API for picture posts at all, and TikTok's photo
  mode needs an approval this app doesn't have. It never sits in the queue all
  week to fail at its slot.
- **The schedule board shows what a picture post is**: an image tile with the
  number of pictures and an "Image" or "Carousel · N" badge instead of an empty
  video thumbnail. Every clip already in the queue looks and posts exactly as
  before.
- **Every step of a run can now give up and say so.** Only the first two were
  guarded: a carousel, a topic split, a set of posts or an export that threw
  was retried every couple of seconds forever while the row said "working".
  After three tries it says what went wrong and offers a retry.

- **What you untick stays unticked.** Scheduling a run kept booking as outputs
  landed — including the ones you had just held back, about a minute later. It
  now remembers exactly what you chose, never re-books something you deleted
  from the queue, and still picks up anything that only finished afterwards.
- **You can stop it booking.** The Scheduler row says when a run is still
  booking automatically and has a button to stop, instead of that only being
  visible inside a sheet that closed.
- **The window title keeps the count on a fresh window**, not just after you
  change screen — which was the case it existed for.
- **A run whose project or clip job was deleted stops asking to be retried.**
  It said "needs attention" forever and every retry answered "it is gone".

- **A clip whose AI caption failed is no longer scheduled behind a green
  toast.** The Uploading Center now names the clips it couldn't write copy for,
  marks those cards amber, and offers "Retry the N that failed" above the run.
  Auto Assign leaves them unscheduled instead of posting fallback copy, and says
  so — the only success message you get now is one where nothing failed.
- **The nightly channel scan can finally be registered.** `npm run
  ingest:register` sets up the 6am Windows task the way the publish runner and
  the Threads autopilot do — run it from the production folder only. Until now
  the registration command sat in a comment and the scan was never scheduled.
- **A stream the scan gave up on can be handed back from the screen.** Channel
  ingest's "Given up after 3 tries" list now has a "Try this one again" button
  that clears the video's attempts so the next scan takes it in — no more
  editing `data/channel-ingest.json` by hand. Each taken-in stream also links
  straight to its pipeline run.
- **Retry can no longer put the same video on your channel twice.** A post
  that reached YouTube and only failed afterwards kept its video id, but
  nothing looked at it before uploading — so one press of Retry (or one
  reconnect re-arming a batch) could upload a second copy of the same clip.
  A post that already exists is now resumed instead: it gets checked and
  flipped public if its slot has passed, and left alone until then. Threads
  works the same way: a post that already went out is recorded as published
  rather than sent again.
- **A reconnect only revives what the reconnect fixes.** Re-arming after
  connecting an account used to put every failed post on that platform back in
  the queue, including the ones the platform itself rejected. Now it revives
  the posts that were waiting on the connection and leaves a rejected video
  rejected.
- **A failed post says what went wrong in English.** The card used to show a
  wall of raw provider JSON. It now shows one sentence and the button that
  fixes it — Reconnect YouTube when the connection is dead, Retry when it is
  worth another go, nothing when the clip file has gone missing — with the
  provider's own text tucked behind "Details".
- **Scheduling a run keeps scheduling it.** The topic segments render for hours
  after you press "Schedule everything from this run", and the long-form export
  often lands after the shorts — those are now booked as they finish, with the
  app closed, instead of needing another trip back to the run.

- **The sidebar count actually appears now.** The badge that says how many runs
  need you was gated on the wrong address and never rendered once; the window
  title also lost its count the moment you changed screen. Both fixed.
- **A stream whose download died has a button.** "Start this stream again" runs
  the same link through the pipeline and clears the dead run, instead of
  copy-paste-delete-start.
- **"Render all segments" can stop.** A segment that fails to render twice is
  given up on rather than restarted every couple of seconds — which, left
  alone, eventually pushed the run's own long-form export off its list.
- **Retrying a stage clears the red text above it.** The failure notices only
  ever piled up, so a fixed stage sat under its own old error.
- **The Scheduler stops promising what it cannot do.** Carousel slides and the
  visual ad are counted as "to post by hand", not as outputs the Schedule
  button will book — and a booking where nothing was scheduled no longer
  reports success.
- **A stage that gave up is told apart from one that had nothing to do** by what
  actually happened, not by re-reading the transcript afterwards — which got it
  wrong for a run whose project had been deleted.

## 2026-08-06

- **Pick the platform and the hashtags once for a whole run of clips, not once
  per card.** The Uploading Center now has a "For this run" bar above the
  clips: a platform and a set of hashtag chips that every clip follows, and
  changing them re-aims the cards already on screen. The choice is remembered,
  so the next run opens the way the last one ended instead of back on YouTube
  with no hashtags.
- **"AI captions for all" writes the whole run's captions in one click**,
  counting up as it goes and skipping any clip that already has one. A clip
  whose copy fails is reported and stepped over — it no longer costs you the
  captions behind it.
- **Auto Assign now posts what you would have posted by hand.** It uses the
  run's platform and hashtags, writes a caption for anything still blank, and
  only then books the next open slots — instead of filing everything to YouTube
  with an empty caption.
- **Captions survive a reload.** Anything typed or AI-written on a clip card is
  saved in the browser with its platform, so reloading the page or switching to
  another run no longer throws the copy away.

## 2026-08-06

- **A music generation is no longer lost by closing the tab.** The track was
  paid for at submission but only imported by whichever poll first saw it
  finish, so a closed tab stranded it; the server now checks the pending ones
  itself.

- **The command bar stops claiming it can act when it can't.** Arming lasts an
  hour on the server, and the bar used to keep saying "Can act" long after it
  lapsed — every command then quietly ran read-only and the orchestrator just
  said it couldn't do things. It now re-checks whenever you come back to the
  tab and on every send, turns red saying **Arming expired**, and one click on
  that arms it again.
- **A reload no longer wipes the conversation.** Installing an update restarts
  the app under you; the command bar now remembers the last twenty lines and
  what it was talking about, so you pick up where you left off.
- **"Start that" now takes you to where it's happening.** Starting a pipeline
  run, a channel scan or the agent team used to leave you on whatever screen
  you were on holding an id. All three now open the screen that shows the work,
  the way retrying a stage already did.
- **The channel check is no longer a dead end.** It lists what it skipped and
  why, and now hands back each video's link and whether that skip is one you
  can overrule — so you can say "run that one anyway" and it goes straight
  through the pipeline. Its report also survives the check finishing, which it
  didn't before.
## 2026-08-06

- **The app notices work the moment it lands, instead of when a backup runs.**
  This machine keeps two copies of the code — GitHub, where finished work is
  merged, and a local backup repository that syncs down from it on a schedule —
  and the app was only ever looking at the backup. Anything merged in the last
  day was invisible to "Check for updates", while the release's own changelog
  commit went the other way and reached only the backup, so the two drifted
  apart and had to be put back together by hand. Everything that reads or
  writes the code now uses both, and takes whichever one is genuinely further
  ahead.
- **The window title carries what needs you.** When a run breaks, the taskbar
  window reads "(1) Capital Command" — so a stage that failed while the app sat
  behind something else is visible without opening it.

- **The text posts a stream produced can be scheduled from the run.** They used
  to leave the app only by being copied out one at a time. The Threads ones now
  go on the same queue the autopilot drains, spaced out and from one account
  (two accounts posting identical words reads as mirrored spam); the X and
  Facebook versions stay there to copy. The day's own pack is unaffected — the
  autopilot cannot see these when it decides whether a day is planned.

- **"Render all segments" is one click, not one per segment.** The run keeps
  rendering the next topic segment as each one finishes — with the app closed —
  instead of waiting for you to come back and press it again.
- **The overnight report counts the topic segments.** It said "ready to
  schedule" while five ten-minute videos still needed a click; it now says how
  many of them are rendered, and whether the podcast episode went out.
- **Podcast episodes get real show notes.** The unattended pipeline published
  the episode described by the raw stream name; it now writes the description
  first, and falls back to the name only if that fails.

- **You can add an episode to the podcast feed yourself.** The Podcast page now
  lists every finished long-form export and publishes the one you pick — cutting
  the MP3 first if it hasn't been cut, and writing real show notes instead of the
  raw stream name. When the feed can't take anything yet, it says which thing is
  missing and exactly what to do about it, instead of a bare warning.
- **A channel scan that failed says so.** The Channel ingest panel used to read
  "Nothing taken in yet" whatever happened; it now shows the failure and its
  reason, tells you when YouTube needs reconnecting (with a link to do it), and
  lists the streams it skipped for review or gave up on.
- **One button schedules everything a stream produced.** The Scheduler step of a
  run now lists every output that is ready — the long-form video, each rendered
  topic segment and every short — and books them into the publish queue, one per
  free slot, longest first. Anything already scheduled is left alone and says so.
  The long-form video and the segments had no route into the queue at all before
  this; they were downloaded and uploaded by hand.
- **"Open the Uploading Center" opens on the right run**, instead of leaving you
  to guess which job in the dropdown was the one you were just looking at.

- **A post that failed no longer disappears — you can see why and retry it.**
  A scheduled post whose every platform permanently failed used to be deleted
  the next time the calendar loaded: the slot emptied, the clip went back to
  Draft, and the reason only ever reached a console log. Failures now stay on
  the board with the reason under them and a Retry button that puts the post
  back in the queue and sends it. Same on the Threads day view — a failed post
  keeps its copy and gets a **Retry now** button instead of needing to be typed
  out again. A post blocked as "manual" because an account wasn't connected can
  be retried the same way once it is, and old failures are only swept 30 days
  after you have actually seen them.
- **A run that broke stops pretending it finished.** The pipeline list showed a
  green "Finished" for a run whose stages had failed — the sidebar now carries a
  count of runs needing attention, and the row says which and how many.
- **A skip that was never going to work stops asking to be retried.** A stream
  with no speech, no second topic or no audio track is a skip by design; only a
  stage that actually tried and gave up offers "Try this again".
- **A run whose source went missing no longer says "Working…" forever.** After
  three failed attempts it says what went wrong and offers a retry, instead of
  re-trying the same doomed call every two seconds with no way to act on it.
- **The pipeline keeps moving with the app closed.** Runs only advanced while a
  browser tab was polling, so a stream started at 11pm froze when the tab shut;
  the server now ticks them along itself.

## 2026-08-06

- **Every stuck stage now has a Try this again button, right on the row.**
  A run that broke also gets one line at the top saying what stopped short and
  a single "Try them all again". The Topic segments button used to be a link to
  the editor that rendered nothing — it now renders the next segment and says
  how many are done. Same repairs the command bar performs, so the button and
  the answer can never disagree.

## 2026-08-06

- **A scheduled task can no longer start a second server into a running
  build.** The publish runner and the threads autopilot start the app when
  nothing answers on port 3000, which during a release meant serving a
  half-written build, taking the port from the build that wanted it, and two
  builds writing the same folder. They now leave a build alone and skip the
  tick.

## 2026-08-06

- **The command bar fixes a stuck run instead of telling you it is stuck.**
  Say "go back to Day 28 and finish it" and it finds the run by name, sees which
  stages failed or were abandoned by a restart, and starts them again — the
  long-form export, the podcast MP3, the topic split, missing clips, the
  carousel, the text posts. A long-form export that died mid-render is retired
  and re-rendered rather than sitting at "Rendering the edited video…" forever.
  It can also render a topic segment on request. It still never publishes,
  schedules or deletes anything.

## 2026-08-06

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
