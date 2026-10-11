# Changelog

What each release brought into the running app. Newest first.

A "release" is one run of `Update CoLateral Marketing.bat` (or the app's own
**Install and restart**): it brings the running app up to what has landed on
`main`, rebuilds, and restarts the server. Until you run it, nothing here has
reached the app you use — that is the whole point of the split.

Every change made in the sandbox adds a line under **Unreleased** before it is
committed. The release moves that block under a dated heading — `update-app.ps1`
does that itself, so this file can never claim something is waiting that has
already shipped.

## Unreleased

- **A clip you have booked collapses to one line in the Uploading Center, and the bulk panel says what it will really do.** A booked clip shows its picture, its title, "Booked Mon, Oct 12, 7:30 AM on YouTube" ("Posted ..." once it has gone out, "Partly posted ..." while only some platforms have) and a "Show on the board" link instead of a draft caption box and ten hashtag chips for a clip that is already done; "Edit for a new booking" opens the old controls when you want to book it again (a clip whose posts all failed keeps its full card and retry). Customise now says "Captions: the clip titles (no AI key set)" instead of "AI writes 4 captions" when no AI can write them, and "No hashtags chosen - channel defaults are added" instead of a bare "no hashtags" over posts that carry four. Status chips on narrow cards wrap with room between rows and keep their full words.
- **Scheduling one clip with an empty caption box no longer posts it with no caption.** The box said "leave empty to auto-generate on schedule" but nothing did, so a clip booked from its own card went out with a blank caption and only #shorts. Now an empty box is filled when you press Schedule (with the clip title when no AI key is set, and the same "Captions are the clip titles (no AI key)" note says so), and every other way of booking gets a caption and the clip's own hashtags too. Customise's hashtag chips are filled with a tick when on and outlined with a plus when off, and its summary says "no hashtags chosen" instead of reading like the ten suggestions are already on your clips. The line under "Should be live" now says why ("Its slot passed - YouTube should have published it by now.") instead of repeating the chip.
- **A post past its slot reads the same everywhere.** A YouTube or Facebook post that should be live by now (or one the publisher never sent) shows "Should be live" / "Overdue" (or "Needs Instagram connection" when that account is not connected, the same wording as the Uploading Center) on Day Summary and the Master Calendar too, and no longer counts as "Scheduled" or "still to go"; Automations moves it from "Still going live" to "Should be live now - check YouTube/Facebook" with a link to the platform. Day Summary's "Open latest post" says "Open in Uploading Center" or "Open in Threads Autopilot" with an in-app arrow when it stays in the app, and a failed Threads post on the Autopilot board reads "Threads connection expired - reconnect in Settings" (a link) instead of "Threads API error (190)", with the original text under Details.
- **Day Summary and the Threads board stop contradicting each other.** Day Summary's Today, Yesterday and Tomorrow now follow the publish time zone (Toronto) instead of the browser clock, so a UTC browser no longer opens on Sunday while everything else says Saturday (the Master Calendar's Today button and today highlight follow it too); each platform row in Last 7 days opens that platform's own tab (Instagram's "Open latest post" no longer lands on TikTok); a failed Threads post says why ("Threads connection expired - reconnect in Settings") with a link to Settings or to that day on the Autopilot; on the Threads page, Scheduled & sent rows carry an account chip so the pair behind each number is told apart, and Today's posts are listed in clock order with one line explaining that a 1:20 AM or 2:55 AM time is that same morning, not after midnight.
- **Scheduling several clips at once no longer books the last one with an empty caption, and a post that missed its slot says so.** "Schedule 4 clips" wrote each clip's caption but planned the booking before the screen had caught up, so the last clip went out with no caption and only #shorts; all four now carry their captions. With no AI key, "Captions are the clip titles (no AI key) - edit them from each post's Caption button." now stays in the booking summary until you dismiss it instead of vanishing with the toast. A post whose slot passed while it was still waiting now shows Overdue (linking to Automations: the publisher hasn't sent it yet), and a YouTube or Facebook post that should have gone live by itself shows "Should be live - check YouTube" instead of sitting silently as Scheduled.
- **Day Summary says what its YouTube numbers are, and what to do about a failed post.** The strip now reads "Views so far on the 2 videos posted yesterday" (lifetime views, not views earned that day) and Last 7 days says "Views so far on videos posted in the last 7 days"; when a day is the whole week's YouTube posting, it says the numbers are the same instead of repeating them silently. A failed card now gives a one-line reason per platform (for example "The TikTok connection expired or was revoked") and a "Fix in Uploading Center" link that opens that platform's tab on that post.
- **Threads posts per day is editable on Automations, and auto-booking overnight streams asks first.** The Cadence card's Edit mode now includes Threads posts per day (1 to 48, per account), applied live with no restart; it takes effect from the next batch the autopilot plans, lowering it never moves posts already queued, and raising it mid-day can re-space the rest of today's unsent posts (the card says so). `.env` names now sit under "Advanced: set in .env" instead of beside every value, and saving sends only what you changed. Turning on Auto-book overnight streams (on Automations and in Settings) now shows a confirmation that posts go out with copy you haven't reviewed, and a one-line consequence sits under the toggle.
- **Uploading Center, Distribution Centre and the carousel scheduler read cleaner.** The Instagram and Facebook "not connected" banner no longer breaks into three columns - it now says the same sentence as TikTok and YouTube ("Bookings for Instagram are saved as reminders until it's connected - each shows Needs Instagram connection"); after a bulk booking with no AI key the notice says the clip titles were used as captions and points at each post's Caption button instead of asking you to edit before booking; "Manual" is now "Post by hand" (Distribution Centre) or "Reminder only" (carousel TikTok and YouTube tiles); the Text-only post card says "The Threads autopilot isn't confirmed running" with an Automations link instead of "background runner"; and the booking summary in the run card is still there after a reload until you dismiss it.
- **Threads Autopilot no longer lets one click wipe a day's pack.** Once today's pack exists the button reads "Rewrite today's pack" (a quiet button, not the main one) and asks first, saying what is replaced: the posts still waiting on the queue are swapped for the new pack's at its times, so the page and the autopilot always show the same posts. It turns itself off with the reason shown the moment any of today's posts has gone out or failed ("edit or skip individual posts instead"), and it keeps your written pack rather than replacing it with 24 stock ideas when the AI cannot be reached. The pack header now says "Pack times" (earliest to latest, no more backwards "9:05 AM to 2:20 AM") beside "Autopilot window", the Scheduled & sent board opens on Today (or the `?date=` you asked for) instead of Tomorrow, posts are numbered 1 to N in sending order with each account's name beside it, Remove is a red outlined button that asks before deleting, and Skip and Edit copy are quiet buttons.
- **Threads Autopilot's pack header tells the truth about the schedule.** The "~every 40 min" badge is gone: it now reads your real cadence (for example "24 a day, about every 60 min, 12:20 AM to 11:20 PM") and, when the pack is a different size, says so ("Today: 6 posts in the pack; the autopilot posts up to 24 a day"). Today's pack no longer shows "This is an earlier batch" just because it was written a while ago - only a pack from a day that has ended in your Threads time zone does - and the disabled Add to the queue button now says "Connect a Threads account in Settings > Accounts first" with a link.
- **You can change the posting cadence from Automations.** The Cadence card now has an Edit button for shorts per day (1 to 6) and the weekday and weekend posting times (1 to 8 each), saved straight away with no restart and no editing `.env`. Changes apply to new bookings; already-booked posts keep their times. Time zone, booking reach and the Threads settings stay read-only there, and `/automations#cadence` jumps to the card.
- **Uploading Center says what bulk booking did, and says it the same way everywhere.** After "Schedule 4 clips" a summary appears as a toast and stays in the run card until you dismiss it ("4 booked: Mon-Thu", or "4 saved as reminders - YouTube isn't connected. Connect it to post automatically.", or both). A leg waiting on a connection reads "Needs YouTube connection" on every card (never "Manual"), and "Post by hand" once its slot has passed; a refused title offers "Connect YouTube to retry" beside Rename. The run summary counts the hashtags the cards really carry, the board footer reads "Times shown in Toronto time. Up to 2 shorts a day - change this on Automations." instead of UTC and an environment variable, and renaming a post gives the title the full card width.
- **Uploading Center, Automations history and the Threads pack now tell time on the publish clock too.** "Goes live", "Live since" and "Uploaded" on a clip card, the Automations activity list, and which day counts as "Today's pack" on Threads Autopilot all follow your publish time zone (Toronto by default) instead of the browser's, so a laptop set to another zone no longer shows a different hour or picks tomorrow's pack at 8 PM.
- **Threads Autopilot shows every time on the autopilot's clock.** "Coming up next", the scheduled-and-sent clocks, the time you type to move or add a post and the reply and pack stamps all read in your Threads time zone (Toronto by default), so a computer set to UTC no longer shows "12:00 AM" beside a card that says 8:00 PM. When your computer's zone is different, the header says "Times in Toronto time (EDT)".
- **A carousel that is already booked now says so.** Its card shows "Booked Tue, Oct 13, 12:30 PM · Instagram + Facebook" with a link to the post in the Uploading Center, and its Schedule window offers "Open in Uploading Center" instead of letting you book it again. Booking a deck twice now says "This carousel is already booked for Tue, Oct 13 at 12:30 PM." in your time zone instead of a raw timestamp and post id.
- **Booked carousels read straight, and the Day Summary explains the missing YouTube numbers.** A booked deck's Schedule window now shows Instagram and Facebook as "Booked Tue, Oct 13, 12:30 PM EDT" (not selectable) and only offers Save reminder once you pick TikTok or YouTube; booking chips and messages add the zone (EDT) when your computer is in a different one. "Last 7 days" on the Day Summary now says "1 video has no numbers yet" with the reason (held private for review, no video id on record, or not read from YouTube yet) beside "across 2 videos".
- **Distribution Centre no longer crops its tree.** The Transcript and its text formats wrap into panels instead of scrolling off the right edge. The "Settings > Accounts" setup hints now link to Settings > Accounts, the X posts card counts "Threads posts today" the same way Day Summary does, and the failed-posts chip says "see why in the Uploading Center".
- **Day Summary has a "Last 7 days" view, and its YouTube numbers no longer jump in.** Per network (YouTube, Instagram, Facebook, TikTok, Threads) it counts what published, failed and is waiting for a hand-post, adds up YouTube views and likes, and shows the week's top video with Open and Analytics links; the other networks say where their views live ("Views on Instagram - open the post"). The YouTube strip now holds its place with "Loading YouTube numbers..." below the header, and the last saved numbers arrive with the day instead of seconds later.
- **Old YouTube numbers say what to do.** "Updated 12 min ago" when fresh, "Numbers from 2 days ago - connect YouTube to refresh" when YouTube is not connected, replacing "not refreshed, see each video's date".
- **Threads and Automations now show the same numbers for today.** The Threads page, its header and the Automations card agree: "3 of 7 posts sent today" counts each idea once (with "6 of 13 sends across 2 accounts" spelled out), includes hand-added posts, and "Next post" is the earliest waiting post in the autopilot's own time zone on both screens. The header describes the posts a day you actually set and the pack actually written, instead of a fixed "24 posts plus 20 replies", and "Scheduler checked never run" now says "The autopilot hasn't run yet on this computer".
- **Automations warnings put what you can fix first.** An expired TikTok connection or failed post now leads the card instead of sitting behind "can't read the Windows task"; the toggle reads "Show N more warnings" / "Show fewer", and "Windows task", "heartbeat" and "worker" became "background runner" and plain words (exact commands kept).
- **The sidebar no longer hides the pages you use.** With nothing connected, the three "not connected" account rows are one "Connect accounts" line, and connected accounts are a single row of small chips, so Uploading Center (with its failure badge), Automations, Master Calendar and Day Summary are all on screen at laptop sizes. The active page scrolls into view, and a fade at the bottom shows when there is more. Settings > Accounts now scrolls to Accounts from the "Connect accounts" link and opens the first platform you have not set up.
- **Signing in to YouTube, TikTok or Spotify now shows the result on the page.** Coming back from a sign-in, a green "YouTube connected" or an amber plain-English reason ("the sign-in was cancelled...") appears at the top of Uploading Center, Podcast and Settings and can be dismissed, instead of a toast that never showed.
- **Uploading Center cards stop claiming what cannot happen.** A queued post on a platform that is not connected now says "Waiting for YouTube connection" (not "Uploading" or "Posts at slot") with a Connect link; Publish now is hidden when nothing on the post is connected, and when only some platforms are its confirmation lists those and says the others stay waiting (they are no longer failed by the attempt). A failed TikTok post shows Connect/Reconnect instead of a Retry that could only fail, a reminder set aside for lack of a connection stops saying "Not connected" once it is, and Rename and retry only retries after connecting.
- **Renaming a post says how to finish.** The title box under a card now shows "Enter to save - Esc to cancel" with save and cancel buttons.
- **Settings > Accounts now tells a new install where to start.** A "Get started" strip lists every platform with where it stands and one next step, with YouTube recommended first; click a line and that row opens. Once one platform is connected it says "You're set up". The redirect address under YouTube and TikTok now says it is the one the app sends, and warns when the address bar differs (127.0.0.1 versus localhost).
- **A failed sign-in explains itself and stays until you dismiss it.** "access_denied", "redirect_uri_mismatch" and "invalid_client" now read as plain sentences with the fix, and the message stays in that platform's row on Settings > Accounts until you dismiss it or a later sign-in works. The sidebar's "Sign in with YouTube" prompt, which read like a login wall on every page, is now a quiet "Connect accounts" link that only shows while nothing is connected.
- **See how a YouTube post did.** Day Summary and the Uploading Center now show views, likes and comments beside each published YouTube post, with how recent they are and an Analytics in Studio link. Yesterday shows a total at the top. Other platforms still show posting status only - use their Open on links for numbers.
- **Carousel booking and Distribution stop promising "Automatic" with nothing connected.** Saving a carousel for Instagram and Facebook while neither is signed in now shows an amber warning, labels them "Not connected - saved as a reminder" and the button says Save reminder; Distribution marks formats whose accounts or runners are missing "(needs setup)" with a link to Settings or Automations. On a phone, Carousels and Day Summary no longer push past the screen edge.
- **Automations shows two warnings per card, in plain words.** The rest sit behind "+N more", and lines read "Post title: Threads connection expired - reconnect in Settings" instead of a raw API error.
- **Failed posts on the Uploading Center tell you the fix.** A post's title now has a visible pencil (Rename), a post the channel refused as a duplicate offers "Rename and retry", and a post blocked on a missing connection offers "Connect TikTok" or "Reconnect YouTube" instead of a Retry that fails again. The bulk button is now "Retry N posts that lost their connection", is greyed out with "Connect TikTok first, then retry" while the platform is not connected, and its message names what happened on each platform; the Failed strip says which tab it will open.
- **The schedule board stops showing empty history.** "Show earlier days" counts and opens only the days that have posts (no more rows of "No posts this day"), and a hidden platform tab no longer keeps a second copy of the board in the page.

- **The Schedule dialogs stay put.** On Carousels the Schedule window used to open halfway down the page, scroll away with it and hide Cancel and Book post behind the next card or the command bar. Every dialog now opens over the whole screen, above the command bar, with its buttons always in view (it scrolls inside on a phone) and Tab kept inside it.

- **Sidebar chips agree with Settings, and a failed sign-in stays where you were.** Instagram and Facebook with a saved token now show a muted "saved, not verified" in the sidebar instead of a green dot, the same as Settings. A sign-in that fails no longer bounces you from 127.0.0.1 to localhost, which looked like the app had forgotten your place.
- **The red badge now matches the Failed strip.** The number in the sidebar and the browser tab counts every failed post that is still waiting for you, exactly like "Failed (N)" on the Uploading Center, and opening the page no longer makes it drop to zero. Threads Autopilot says once, at the top, when no Threads account is connected, and no longer promises tomorrow's posts will go out on their own while there is none.

- **The Master Calendar opens on the days ahead.** The week view starts at today instead of ending on it, repeating carousel reminders look like reminders (dashed, with a bell) instead of scheduled posts, and the Distribution Centre shows the next scheduled time in your publishing time zone.

- **Automations reads like plain English.** Failure lines use the post's title cut at a whole word instead of half a caption, and a missing Windows task says "Runner not installed - run npm run publish:register in the app folder". Instagram posts link out only when a real post address was saved, never a guessed one.
- **The Uploading Center says what really happened.** Booking onto an account that is not connected now shows an amber "Saved as a manual reminder for <platform>" instead of a green "Scheduled", and Auto Assign counts booked posts and reminders separately. The AI caption button says when no AI key is set and it only copied the clip title, a manual reminder before its slot reads "post this by hand at <time>" instead of "never went out", and a post that is already live explains that Remove only clears it from the schedule (and is not offered when every platform has it).

- **The Uploading Center opens at the top.** The page used to land scrolled down to today, past the Failed strip, the platform tabs and the bulk button; now days before today sit behind "Show earlier days" and "Show on the board" jumps straight to the post. The bulk button reads "Schedule 3 clips" with the pace underneath, the clip card no longer squashes its AI caption button or overlaps Edit clip, "Connect YouTube" is offered (not "Reconnect") for an account that was never connected, and repeated error toasts collapse into one instead of stacking.

- **Retry and Remove no longer catch you out.** "Retry connection failures" only touches posts that failed (not reminders you may have posted by hand) and leaves anything more than a day overdue as failed, saying how many to retry one by one, so nothing old posts all at once. Remove now stops while a post is uploading or a YouTube video may already exist, and "Remove anyway" is there if you mean it. Publish now never goes out early by accident, and Retry is not offered on a reminder for an account that is not connected.

- **A post that fails again tells you again.** A retry that fails a second time now raises a new alert instead of being treated as the one you already saw, for publish posts and Threads.

- **Retry waits for its slot.** Retry on the Uploading Center board puts back only the platform that failed and waits for that platform's slot. If the slot has already passed, it posts right away. The post's other platforms are no longer published early.

- **Publish now and Remove ask first, and list every platform.** Publish now really makes a held YouTube video public, and the message says what happened. Remove keeps a video YouTube already holds private instead of letting it go live, and warns about any Facebook posts it cannot cancel.

- **The board edits captions and says what really happens.** You can edit a scheduled post's caption from the board. YouTube's description isn't changed, and the board says so. Renaming a post confirms it. TikTok inbox drafts read "In TikTok inbox", posts waiting on a retry or on YouTube's upload limit say so, failure messages are plain, and the advice is right for each platform.

- **Bulk "Schedule N clips" respects the shorts-a-day limit.** It spreads clips across days, so "Schedule 6 clips: 2 a day from tomorrow" does what it says. Full days show "Day full", and pressing it again no longer gets stuck. The limit now counts videos, so one clip booked to every platform counts once.

- **Scheduling is easier to follow.** "Schedule everywhere" gives one summary with a line per platform. YouTube-to-Instagram/Facebook mirroring is named on the platform picker and on mirrored posts. The picker sits next to the schedule button, the page opens on today, and /clips cards have a Schedule link. Distribution Centre tells you what posts where (Automatic, Reminder, Copy-only or Manual) for each format, and the same word appears next to Schedule buttons. The editor's Schedule Short says YouTube only. The pipeline sheet says "Book N at the next free slots", and long-form is marked "held private for review".

- **Carousel Schedule now really posts.** A one-off carousel to Instagram and Facebook is booked and goes out at the time you pick, with the default set to Once, tomorrow. TikTok, YouTube and repeating schedules are clearly labelled reminders instead of "Upload scheduled."

- **"AI caption for all platforms" writes short copy that fits every platform.** Its hashtags are no longer posted twice on Instagram, TikTok and Facebook.

- **Turning posting off no longer hides the Uploading Center.** The schedule, accounts and Connect buttons stay visible read-only under a banner that says what stopped. Posts YouTube or Facebook already hold still go live. "Allow posting" is now "Allow video and picture posting" and says what it stops.

- **Automations can pause and resume all posting.** "Pause all posting" and "Resume all" are there now. A list shows the posts YouTube, Facebook and Buffer will still publish by themselves, with links to each. A read-only Cadence panel shows the posting times, and the .env setting behind each one.

- **Automation status reads in plain words.** Runners show "every 5 min" and "Last ran" instead of engineering labels. A missing background task shows the exact command to install it, plus how to keep the PC awake.

- **Failures are easier to find.** Uploading Center has a "Failed (N)" strip across all platforms, with a jump to each post and a "Retry connection failures" button. A line says whether the publisher is paused, not installed, or when it last ran. The sidebar badge and the "(N)" window title count posts that failed when due (including ones where only one platform failed) and failed Threads posts. Uploading Center and Threads get their own badges, and when the app is open in CoLateral, each new failure also lands in its notification bell.

- **Threads Autopilot says what it is doing.** The Threads page is renamed Threads Autopilot, and it says "Paused" instead of "Armed" when paused. It announces "Tomorrow's N posts are ready" and has "Preview next run", which posts nothing. You can write and queue your own Threads post, and each post shows its X wording with a Copy button. "FB / IG Threads" is renamed FB / IG Post Library.

- **The command bar opens more screens.** It now opens Podcast, Automations, Execution and Finance (when shown).

- **Master Calendar and Day Summary show what really happened.** Threads posts show their real status instead of "suggested". A post that lost one platform reads "partly failed" and opens that platform, and a red "N failed" chip shows on Master Calendar and Distribution. Day Summary has a Yesterday button, "Open on YouTube / Facebook" links, posts to make by hand, and long-form held for review says so. "Plan this week/month" plans from today and links each suggestion to its day.

- **Signing in is clearer.** Signing in with YouTube, TikTok or Spotify before saving app keys now goes to Settings > Accounts with a plain message instead of a raw error page. Finishing a connection no longer lands you back on the setup screen. Sidebar chips turn amber with "Reconnect <platform>" when the last post failed because the connection expired.

- **Settings explains each connection.** Settings > Accounts shows the exact redirect address for Google, TikTok and Spotify, and says where each value comes from ("Set in .env - edit it there"). Pasted Instagram and Facebook tokens show as "Saved - not verified", and there is a Media hosting row. Channel name and handle can be changed in Settings > Profile. The unused YouTube API key field is gone.

## 2026-10-04

- Update history saves how long each step took, separates compilation, retries and startup, and highlights the slowest step so future delays are easy to spot.

- Marketing updates use the fast compiler again, isolate build settings from the running app, and stop retrying failures that clearing the cache cannot fix. Build output reaches the update log while it runs.

## 2026-10-02

- Threads daily and stream posts now get a relevant CoLateral follow-up with tracked links, visible previews and delivery status. Pausing stops queued replies, retries keep their identity, and repeated stream scheduling no longer duplicates posts.

- Clip editing recovers the newest complete draft, times out stalled saves so you can retry, and keeps renders recoverable until stopping is confirmed.

- Production builds use the compatible Next.js compiler so native media tools do not block installation.
- Video and music previews seek correctly, carousel generation uses the whole stream and preserves edits made while it writes, and invalid requests show helpful errors.
- Saving connected accounts together now retains every connection, and repeated agent approvals cannot create duplicate work.
- Scheduling and Threads autopilot preserve simultaneous edits, avoid duplicate bookings and uploads, and use the configured timezone consistently.
- Stripe billing separates currencies and captured sales, includes every result page, and estimates recurring revenue from subscription prices instead of one-time purchases. Unavailable history is labelled clearly, and failed billing loads offer Retry.

- CoLateral Marketing now uses the same name in canvas messages, startup and desktop launchers, package metadata and setup documentation. Existing saved data, canvas cards, connection tokens, shortcuts and scheduled-task identifiers remain compatible.

- **Marketing fits the CoLateral array more reliably.** Compact cards use one
  route menu, keep assistant controls clear of the content, and follow the
  host's appearance. Keyboard navigation identifies the current page and
  returns focus when dismissed. Populated clip and schedule controls fit
  narrow panes, and the desktop assistant follows the content pane's gutters.

- **Failed loads explain how to recover.** Startup waits for saved data instead
  of briefly showing new-workspace controls. Failed workflow reads keep the
  last loaded work visible with a Retry action. Calendar period failures no
  longer look empty or show another period's events; filtered events have a
  Show all sources action. First-run Settings opens, and a failed profile save
  cannot mark setup complete.

- Automations now keeps seven days of delivery and worker history, with filters, retry times and separate counts for successful deliveries, delivery failures and worker issues.
- Video exports keep the best available source: Shorts can render at 4K vertical, new clip editor projects retain source size and frame rate, each pipeline keeps its chosen quality, and motion segments render sharp 4K text without an intermediate JPEG pass.
- Visual ads now start from a real stream frame, preserve the full picture and your likeness, and let you review the source, adjust the copy and export the finished ad.
- Podcast episodes can be scheduled automatically, with saved delivery times, retries and clear hosting or Spotify setup blockers.
- Automations has its own dashboard with persistent pause controls, upcoming work, scheduler status and recent outcomes for the pipeline, ingest, publishing, Threads and podcasts.

## 2026-09-30

- **The home screen is a picture of the pipeline now.** Before a stream is sent
  it shows the whole flow — one long video in, fanning out to a long-form edit,
  shorts, podcast, carousel, posts and a visual ad, ending in the scheduler.
  Once a run starts the same picture fills in with the real thing: the stream's
  frame, the shorts' thumbnails, the carousel's first slide, the posts as
  written, the wave moving while the podcast renders and a calendar filling as
  things are booked. Click any tile for its steps; every button and retry is
  still there under **Steps**. Earlier pipelines are thumbnail cards with a
  ten-segment strip instead of a bar, so a stuck stage shows up red at a glance.

- **New carousel template.** Slide 1 is now a full-screen frame from the
  stream — Opus looks through frames from across the stream (including the
  opening and closing minutes when you're on camera), picks the one most likely
  to stop a scroll, and the headline goes over it in huge type with the key word
  in a blue box. Under each screenshot, the Beam Buddy, CoLateral and
  colateralai.com strip now sits in what used to be empty space. The flat navy
  is gone: slides are black with blue and violet glows, a fine grid and grain,
  or white and airy like colateralai.com — pick in **Settings → Carousel
  look**. Posted carousels now carry your name and handle too; before, only the
  in-app preview did.

- **Carousels tell a better story and plug CoLateral.** Before writing, Opus
  now finds the story in the stream — what I needed, what got in the way, what
  changed, how it ended — and every slide ends on a line that makes you want
  the next one, with the big reveal held for the payoff slide. Every deck, not
  only ones with stream stills, now gets a second pass that swipe-tests each
  slide and rewrites the weak ones. **colateralai.com** is in the header of
  every slide, and the last slide has a "Try it at colateralai.com" button
  next to the Follow button.

- **Carousels are rebuilt from the copy up.** Opus 5.5 now writes every deck
  through Claude Code on this machine, as one story: a hook that makes a promise,
  each slide leading into the next, a payoff and a follow-up that gives people a
  reason to follow. Keywords are **bold** in CoLateral blue. After the stills are
  cut, Opus looks at each picture next to its slide and rewrites the slide or
  drops the picture when they don't match, and drops repeats of the same shot.
  The slides themselves are redesigned in CoLateral's look: Inter type, a dark
  blueprint grid, the Beam Buddy mark and a progress bar on every slide, a
  Swipe cue, and a Follow button on the last one. If Claude Code isn't
  available, carousels are written by the usual models as before. In the slide
  editor, wrap a word in **double asterisks** to bold it.

- **CoLateral Marketing on the canvas is now as see-through as your Terminal
  Cards.** The app painted its own dark veil and near-solid panels over the
  card's glass, so the two stacked and the card looked almost opaque next to a
  terminal at the same setting. Inside a CoLateral card the page now leaves the
  one fill to the card, and panels are a light tint with no extra blur. Menus
  and pop-ups keep their fill so they stay readable.

- **Agents on the CoLateral canvas can now work this app, not just look at it.**
  A CoLateral Marketing Card used to be a window: the canvas could frame the app and
  nothing more. It can now be asked to open a page, read what is on it, fill a
  field in and press a button — so "put CoLateral Marketing on the uploading centre
  and tell me what is queued" is one request rather than a description of clicks
  for you to do. Pages say for themselves what they offer, so an agent reports
  what the app actually says rather than guessing; anything that publishes or
  deletes is marked as such and is meant to come back to you before it runs.

- **The card can reach every screen, and stops wasting half a small card on the
  sidebar.** Its page list had eleven of this app's thirty-two screens, so most
  of the app was unreachable from the canvas. It now has all of them, grouped
  the way the sidebar groups them, on a rail the card draws itself — and the app
  collapses or drops its own sidebar as the card gets smaller, so a small card
  is the page you wanted instead of mostly menu.

- **Status colours follow the theme instead of staying Tailwind green.** A
  "ready" chip was the same green on all fifteen dark themes while everything
  around it changed, which is the most visible way the app stopped matching the
  canvas. Success, warning, danger and info are now part of each theme, taken
  from CoLateral's own, and most screens were moved onto them.

- **A theme CoLateral has that this app does not no longer falls back to Dark.**
  The canvas now hands over the colours it is actually painting with, not just
  the name of a preset — so a theme added to CoLateral after this app's last
  release, or one you recoloured yourself, paints the frame correctly anyway.
- **The best-of edit now finds the story and watches the footage.** It works out what the stream set out to do and cuts to that arc: it opens on the goal, ends on the result, and gives every passage a role. A passage that points back at something the edit skipped either brings that part in or goes. Every clip is watched before it goes in: with a vision key (Anthropic or fal), a model looks at six frames of it against what you are saying, and a blank, loading, off-topic or private screen is swapped for the next best passage. Without one, a scan of the footage still drops blank and "starting soon" screens and trims them off the ends of clips.
- **Filler words and dead air are cut inside every clip.** Um, uh, doubled words and long pauses between words come out, each clip starts on its first real word, and the captions leave the cut words out too. The Best-of tab shows how many of each were cut.
- **Zoom cuts in the best-of edit, if you want them.** A switch in the Best-of tab makes a jump cut inside the same shot alternate between the wide frame and a punch-in. It starts off, and cuts to new material stay straight cuts.
- **Building the edit no longer ties up the button.** It runs in the background with a progress bar that names the step it is on, and a failed build says why.
- **Account setup has one clear place in the Uploading Center.** The duplicate YouTube connect controls are gone. Primary accounts now point to Settings for credentials and sign-in, while extra YouTube and TikTok accounts keep their own sign-in buttons. Instagram and Facebook reminders explain when credentials are needed.

- **Switching social platforms feels instant.** YouTube, TikTok, Instagram and Facebook calendars stay mounted when you click between them, so scroll position and what you were typing are still there — and the background refresh no longer stacks up while you are on another window.
- **Segment Deck downloads finish faster without losing quality.** Remotion no longer paints one frame at a time — it uses your spare CPU cores (capped safely) and still exports at full resolution with the same master encode quality as the rest of the app.
- Other websites can no longer trigger app updates or start and revoke voice sessions through your local browser.
- **Settings are easier to scan.** Profile, accounts and publishing controls now have clear sections and icons. Each platform opens only when you need its credentials, optional fields stay tucked away, and account badges distinguish saved credentials from a completed sign-in. Appearance, finance and data tools live under More settings.

## 2026-09-26

- **Shorts favour CoLateral on screen.** When clips are picked from a stream, moments where CoLateral is visibly working (an agent finishing, a card filling, a tool being built) now rank well above talk alone, and those clips start within three seconds of that moment. Each clip's score line in the Clip Generator shows its new "CoLateral" rating.
- **No more than two Shorts a day.** New bookings, from the pipeline, the Uploading Center or an auto-queued export, never put more than two short-form videos on one day (Toronto time). Long-form uploads and picture posts do not count. A day that is already full says so instead of booking a third. The limit is `PUBLISH_SHORTS_PER_DAY` in `.env` (default 2). `npm run publish:thin` shows, day by day, how the queue already booked would look at two a day; `-- --apply` moves the extra ones (lowest clip score first, otherwise the latest) into `data/publish-queue.parked.json`, and `-- --unpark` puts them back. It never touches a post a platform already has, or anything whose time has passed, and it refuses to write unless the running app is on a build that reloads the queue.
- **Every post now links to its own colateralai.com path.** When a post goes out, a bare colateralai.com link in its caption becomes colateralai.com/yt on YouTube, /ig on Instagram, /tt on TikTok, /fb on Facebook and /th on Threads, so the site can tell which platform sent a visitor. Links that already point somewhere (/download, /pricing) are left alone. Every YouTube description, Shorts and long-form, now opens with "Try CoLateral: https://colateralai.com/yt". Nothing in the queue is rewritten; this happens as each post is sent.
- **The app is now CoLateral Marketing.** The app wears the CoLateral look: Beam Buddy and the CoLateral wordmark with "Marketing" after it at the top of the sidebar, a Beam Buddy app icon and favicon, Beam Buddy on the update screen, and the new name in the window title, the install prompt, banners and messages. The public site (terms, privacy and the TikTok page) is restyled to match colateralai.com. Run `npm run app:shortcut` once after this release to swap the old Desktop and Start Menu shortcuts for CoLateral Marketing ones.

## 2026-09-26

- **Text stays readable at any CoLateral card transparency.** The canvas now shows through CoLateral Marketing only up to a limit set for each theme (30% on the dark theme, 45% on light), however high the card setting goes, and grey labels sitting straight on the page are drawn brighter while the card is see-through. They pass the WCAG AA contrast minimum over white and bright wallpaper. Text inside panels keeps its usual colour.

- **The CoLateral canvas shows through CoLateral Marketing.** When CoLateral's agent card glass is set to see-through, the app's page background inside the card now lets the canvas wallpaper through by up to that amount, while panels, inputs and text keep their own fills. Solid (0), the Classic surface, flat glass and reduced transparency all stay opaque, and opening the app on its own is unchanged.

## 2026-09-26

- **Threads now sells CoLateral.** A third of every day's posts (8 of 24) are about CoLateral and name it, spread through the day, and the fallback idea library carries the same share. Every post that names CoLateral gets a reply of its own a couple of minutes later, from the same account, along the lines of "see what I'm building here: https://colateralai.com", so the link sits one tap under the post instead of inside it. Stream posts that mention CoLateral get the reply too. `THREADS_PLUG_REPLY=false` switches the replies off and `THREADS_PLUG_URL` changes the link.

## 2026-09-26

- **Short Clips borrows the best of BridgeClip.** Pick a caption look before you clip: eleven new styles (Pop, Impact, Hype, Punch, Glow, Neon, Boxed, Sweep, Editorial, Paper, Subtle), each with a moving preview and burned in with its real font. Choose the clip length (Quick 10-20s, Auto 15-30s, Standard 30-60s, Long 60-90s). A finished run shows its clip count, processing time and $0 API cost; a running one shows its four steps. Clips sit in a tighter grid with the score and length on the video, sort by best or by timeline, and filter by score. Ctrl+Enter starts a run. The Stream Pipeline still clips with the old default look.

## 2026-09-25

- **The update screen shows how far along it is.** While CoLateral Marketing updates, a hopping CC badge and a four-step track (Check, Install, Rebuild, Reopen) show which part is running, next to the real step and the time elapsed. It still reopens by itself when the app restarts, and it keeps still if your system asks for reduced motion.

## 2026-09-24

- **Story edits stay on the whole screen and zoom only on what you point at.** A zoom now needs a line about something small ("look at this", a number, a price) and a place on screen where you are pointing: your mouse, or a popup that just opened. Cuts no longer play a word twice, and yellow captions run through the whole video.

- **Story edits cut less and zoom on purpose.** Jump cuts no longer zoom in and out. A shot now holds for at least five seconds: the whole frame, a zoom onto the part of the screen being talked about, or a quick cut to your camera for a reaction. Short breaths are left in instead of cut, which removes about a third of the cuts, and the cold open gets bold yellow captions.

- **A stream can now become a 10-minute story, uploaded to YouTube as a private draft.** `npm run story:edit -- --url <stream link>` reads the picture and the sound together, opens on the strongest line from anywhere in the stream, then runs setup, the build, the payoff and a close. It cuts the ums, stutters, false starts, repeated takes and dead air, punches in on jump cuts, pushes in slowly on the key lines and masters the sound to -14 LUFS. It writes the chapters, a description that tells the story, 5 titles, 3 thumbnail ideas and 10 candidate frames. The upload is always private and titled `[DRAFT]`, and you publish it from Studio. **Editor > Story edits** shows every cut and zoom with its reason, so you can switch cuts off, swap the hook, pick a different take or change a zoom, then re-render and re-upload. Zooms are centred on the whole frame and never on the small facecam in the corner.

- **A long stream now comes out as a 20-minute video, not a 2-hour one.** The new **Best-of** tab in the Long-Form Editor reads the whole stream, keeps the passages worth watching and cuts the setup, waiting, tech trouble and repeats. The video opens on the strongest line as a cold open and gets YouTube chapters with exact timestamps. Pick 12, 20 or 30 minutes, then tick passages in or out, rename a chapter, or go back to the whole stream. The Stream Pipeline does this by itself for any stream that runs well over 20 minutes before it renders.
- **Chapters from a best-of edit go straight into the description.** Generate the description in the Publish tab and the chapter list is already in it, timed to the cut.
- **Captions now run the whole length of a long video.** A long stream only had its first minutes transcribed for the editor, so topic segments and edits taken from later in the stream went out with no captions after that point. They now read the whole stream's transcript when they render.
- **Cards, the sidebar, the update banner and the command bar are glass now, like CoLateral.** They are see-through with a soft blur and a lit edge instead of flat slabs, and text on them stays as easy to read as before. Inside CoLateral they follow your Appearance settings: Classic surface or Glass strength 0 turns them back to solid, and so does Windows' reduce-transparency setting.
- **A run tells you where it is at a glance.** The top of a run is one card: the stage it is on now (or stuck on), a percent, and a track with one icon per stage that jumps to that stage when clicked. Stages below are single quiet lines, and the sentence explaining a stage only appears while it is working or stuck. Hover a finished stage to read it. Running stages use your CoLateral accent colour.
- **Long-form videos upload private and stay private.** Shorts and reels still go public on their own. A long-form upload, including one already sitting on YouTube as scheduled, is left private with no go-live time. Make it public yourself after you review it.

## 2026-09-12

- **CoLateral Marketing wears whatever theme you picked in CoLateral.** It carried
  two of CoLateral's palettes and six of its own; it now carries all seventeen
  of CoLateral's, under CoLateral's own names, so nothing is translated on the
  way across. Framed in the Command Centre the card hands the theme over on
  first paint and again whenever you change it, and Settings says it is
  following rather than offering a second picker. Opened on its own, the theme
  you pick in Settings is still yours.

- **Long-form videos stop coming out soft.** Three things were stacked against
  them. The downloader's last fallback took YouTube's 360p stream whenever the
  adaptive formats were not served, and nothing said so — the Day 56 edit was
  built from a 640x360, 194 kbps download of a three-hour stream. The renderer
  then upscaled that to a hardcoded 1920x1080 at 30 fps, which also halved a
  60 fps recording. Then the captions pass re-encoded the whole file a second
  time. Now every adaptive format is tried before any muxed one, the edit is
  rendered at the recording's own size and frame rate, captions and overlays
  burn in together, and the file is encoded at full quality exactly once. A
  download that still lands below 720p says so on the run.

- **You choose what comes out.** Two dropdowns under the stream box: resolution
  up to 4K and frame rate up to 60. Both default to Source, which now means the
  best the recording has. A number is a ceiling, never a stretch — a 1080p
  stream asked for 4K stays 1080p, and 60 fps is never invented from 30. The
  choice is remembered for the next stream and stamped on the run that used it.

- **The Stream Pipeline screen is one screen again.** A stream you are working
  on now opens on its own name, with a strip under it naming every format it
  turns into and a dot for where each one has got to — click one and the flow
  scrolls to it. Each stage carries at most one button instead of a row of
  them: the long-form edit, the clips, the MP3, the episode and the carousel
  are each one link, the posts hide behind one, and the scheduler is the only
  place that opens a sheet. The search bar, the repeated stream list and the
  three duplicate ways to book the same outputs are gone from the flow.

- **The eight Studio tools fold away behind one row.** They are opened a few
  times a week and the pipeline is opened every day. The section opens itself
  while you are on one of those screens, and remembers being left open.

- **Descriptions now present CoLateral as the broader agentic workspace it has
  become.** YouTube descriptions, Shorts and Reels captions, carousels, text
  posts and content ideas now describe the project canvas for developers,
  creators and engineers instead of calling it a structural-engineering tool.
  The reusable video description also carries the real website, YouTube and X
  links instead of placeholders.

- **Updates return automatically to the same CoLateral card with less waiting.**
  The card pauses its normal page requests during an update and reopens as soon
  as the replacement server answers. Restart checks no longer fetch Git remotes
  or wait five minutes for the full home page. Build workers skip live pipeline
  startup, and changes outside the app's build inputs reuse the existing build.

## 2026-09-08

- **CoLateral Marketing reads as part of CoLateral, not as a second app inside
  it.** The palette already matched; the type did not — every screen was set
  in Segoe UI one panel away from CoLateral's Inter. Inter now ships with the
  app, so it looks the same framed in the Command Centre as it does on its
  own, and still works with no connection. Numbers in tables stop jittering as
  they update. Six pieces of chrome — the home search bar, the carousels menu,
  both dialogs, the primary button — painted a heavy black shadow that was
  invisible on a dark theme and looked broken on Office Blue; they follow the
  theme now.

- **Fixes from a walk through every screen.** Execution — recurring goals,
  streaks and carry-forward debt — was fully built and reachable only by
  typing the address; it is in the sidebar now. Idea Lab and Scripts were
  called something else once you opened them, and Launch Pad claimed a
  different step than the one it sits under. The Facebook post previews went
  unreadable on a light theme, the Draft chip washed out, and the voice picker
  stayed dark inside a light one. What the walk found, and the rules it leaves
  behind, are in `docs/colateral-theme-audit.md`.

- **Shorts and long-form keep the original picture and sound instead of
  softening them.** Clip sections were pulled at 720p and stretched to fill
  the frame, and both the 9:16 render and the long-form body encoded with a
  fast, lossy setting that turned screenshare text and the mix mushy. They
  now take the full 1080p (1440p when a long VOD has it), scale with
  lanczos, encode at CRF 17, and keep the audio at 320 kbps. The punch-in
  zoom no longer upscales a smaller window either, so the opening of a
  long-form edit stays sharp.

- **An overdue Facebook post stops claiming it is too far in the future.** A
  picture post or Reel whose slot has passed, or is minutes away, is posted
  rather than scheduled — but the board explained that by saying the slot was
  "further out than Facebook will hold a post (29 days)", which is the opposite
  of what had happened. It now says what it says for every other post it has to
  put up itself. Only a slot genuinely beyond the window gets the 29-day
  wording.

- **The personal finance screens are yours to show or hide.** Billing, holdings,
  watchlist, goals and insights are a portfolio tracker that grew up inside a
  publishing app, and they were reachable only if you remembered the URL. They
  are a switch in Settings now — off for a new install, ON for yours, because
  an install already holding accounts and holdings turns them on for itself
  once. Turned on, they get a sidebar entry; turned off, they hide and nothing
  is deleted.

- **Three screens that never worked are gone.** The golf swing analyser and the
  X Reply Studio were both behind redirects to other screens and imported by
  nothing — whole components and libraries shipping in every build for a page
  you could not open. The Higgsfield Avatar screen is gone too: its client says
  in its own header that the endpoint paths are guesses, it needed a key that
  was never set, and it has never produced a video. Its sidebar entry led
  nowhere and now does not exist.

- **The test suite stopped depending on somebody else's rate limit.** One
  publishing test generated its captions by calling a real AI provider, so it
  went red whenever a free tier was busy — a suite that fails for reasons you
  cannot fix is a suite everyone learns to ignore. It uses the same offline path
  a machine with no API key takes, and runs in a fifth of the time.

- **A new install is empty, and yours.** Opening the app for the first time used
  to write a document full of my records to disk — brokerage accounts, holdings,
  an expense ledger down to the receipt numbers — so anyone who installed it
  landed on a dashboard of my money with nothing saying it was not theirs. A
  fresh install now starts empty and asks two questions: whose channel this is,
  and which accounts it may post to. Both are skippable and both live in
  Settings afterwards. Nothing about an install that is already running changes:
  it is recognised as already set up and never sees that screen.

- **Accounts are connected in the app, not in a text file.** Settings has a
  Connections section — YouTube, TikTok, Spotify, Instagram, Facebook and
  Threads, each saying connected or not, with a field per credential and the
  sign-in button right there once the fields are filled. What you enter is
  written beside your data, never shown back to you, and never sent anywhere.
  Anything already in `.env` keeps working and still wins.

- **Exports stop carrying my name.** Rendered carousels were signed
  "Nic Vandewetering / @nvandewetering" and every generated clip carried a
  description full of my links and handles, whoever rendered them. The
  signature is the channel name and handle in Settings, the clip description is
  a box in Settings you write yourself, and both are empty until you fill them —
  an unsigned slide being the one answer that cannot be wrong. The X reply brief
  and the presentation lower third are placeholders now too.

- **Settings is about this app again.** The currency selector, the Alpha Vantage
  market-data card and the "not financial or investment advice" disclaimer are
  gone from it — they belonged to the finance screens, not to a publishing tool.
  "Restore mock data" is "Load demo data", and the demo is invented rather than
  being my real records.

- **The app wears CoLateral's colours.** CoLateral Dark is now what opens by
  default - the same palette as the rest of CoLateral, rather than a slate grey
  that belonged to nothing - and Office Blue joins it in the theme picker as
  CoLateral's light appearance. Every theme you have picked before still works
  and is still what you get. The chrome that ignored the theme and painted
  itself white or violet regardless - the clip editor, the timeline, the
  carousel slide editor, the sidebar avatar - now follows whichever theme is on,
  and four chips in the podcast and uploading screens that were painting no
  background at all got the background back.

- **The app calls itself CoLateral Marketing.** The browser tab, the sidebar before
  you save a display name, the installed-app icon and five page titles all said
  "Nic Vandewetering", which is a person and not this product. They say Capital
  Command now, and the icon is CoLateral's blue rather than a purple NV.

- **The app is usable in a narrow pane again.** In a quarter of a screen — a
  CoLateral card, a snapped window — the top of every screen used to be a strip
  of twenty-three tabs you had to drag sideways through, above a profile row,
  before any of the page showed. That is now one row: the screen you are on,
  which opens a menu of every screen grouped by pipeline step, with the
  connected accounts beside it. Settings moved into that menu, the command bar
  drops its button labels when there is no room for them, and the page starts
  right under the row instead of a third of the way down.

- **Opening the app no longer means waiting for a build.** A launch that finds
  the build already matching what is checked out now starts the server straight
  away — seconds instead of minutes — and only rebuilds when the code has
  actually changed. `start-server.ps1 -Rebuild` forces one.
- **The build itself went from about fifteen minutes to about two.** The app is
  bundled with Turbopack now, and the lint and type-check passes no longer run
  inside it; `npm run lint` and `npm run typecheck` still run them, and every
  change has to pass those before it lands. The old bundler was reaching 21 GB
  of memory on this machine, which is where most of that time went.

## 2026-08-22

- **A day's rundown as one page you can send.** `npm run brief:day` writes a
  standalone HTML briefing for any posting day — every piece in time order with
  a frame cut from the real file, the networks each one lands on and its state,
  a per-network breakdown, the day's Threads posts, and a section listing
  anything whose media is missing or whose upload failed. It reads the queues
  off disk, so it can be pointed at the production `data\` folder from a
  sandbox: `npm run brief:day -- --date 2026-08-23 --data <dir> --out <file>`.
  Defaults to tomorrow.

- **A day's posting, read as a briefing.** The new **Day Summary** screen, under
  Calendar next to the Master Calendar, answers "what is going out tomorrow" in
  one look: how many pieces, to which networks, how many are scheduled, already
  out, or still need you, and the first and last posting time of the day. Under
  that, every piece is a card with a frame cut from the real file — the clip's
  own thumbnail, slide one of a carousel — grouped by shorts, carousels, Threads
  packs, FB/IG and long-form, each group with a button straight into the screen
  that manages it. Today and Tomorrow are one click apart, any date is one date
  picker away, and the calendar's day view now offers the same day as a summary.
- Agent sessions working on this repo now route mechanical work to cheaper
  models, keeping the weekly Claude limit for the work that actually needs
  the big one. Docs-only change; nothing in the app behaves differently.
- **The daily Threads posts got a lot shorter and stopped sounding like a
  model wrote them.** They were running as long as the box allowed and using
  the industry wording straight out of the positioning brief, which reads as
  drafted and gets scrolled past. From the next pack on, each post is one
  thought in plain words, roughly 70-150 characters with a slightly longer
  second version, written to leave a reader something to say back rather than
  closing with a neat verdict. The offline idea library was rewritten to match,
  so a day the model is unavailable sounds the same.

- **The TikTok demo video has a script now.** The shot list said what had to be
  on screen but not what to say over it, so recording meant improvising the
  narration nine times. `docs/TIKTOK-DEMO-SCRIPT.md` is one 110-second take,
  line by line, with the checks to run first - including the two that fail on
  camera otherwise: the TikTok inbox being full, and the run being set to
  YouTube alone so the consent panel never appears.

- **The TikTok demo video cannot be recorded the way the playbook said.** A
  direct post cannot succeed from the sandbox client key, and that refusal
  never lifts however the review goes, so the shot that filmed a post going
  live on the profile does not exist to film. That shot now films the consent
  gate and TikTok's own refusal, and the draft shot carries a warning to clear
  the TikTok inbox first or it fails on camera.

- **The TikTok app's product page, Terms and Privacy are live again.** The URLs
  registered against the TikTok app pointed at files in a private repo, so a
  reviewer clicking them got a 404 — on its own enough to be rejected a second
  time. `site/` is now published by GitHub Pages at
  `nic21vdw.github.io/capital-command`, and the resubmission playbook carries
  the real addresses instead of a placeholder.

- **Shorts open on the first word instead of the pause before it.** The app has
  always known where a clip's first word lands, but only the preview acted on
  it — the file that actually posted still opened on up to a few seconds of
  dead air, and every preview hid that. The ready-to-post render now cuts it
  (never more than a quarter of the clip, never leaving one under five
  seconds), and the burned captions slide back with it.
- **Every short is mastered to the same loudness as everything else in the
  feed.** Shorts were muxed with whatever the stream recorded — no gain
  staging, no loudness target. They now go out at -14 LUFS under a true-peak
  ceiling, with a gentle compressor so a quiet aside stays audible next to a
  loud point. Clip Editor exports get it on their finished mix too, after the
  music and effects balance, so the balance you set is what gets normalized.
- **Burned captions and screenshare text come out sharper.** The 9:16 render
  encoded at the speed setting that hurts fine text most, and the platforms
  then re-encoded that softness. It renders a step slower and cleaner now.
- **Automatically scheduled shorts finally carry hashtags.** Anything booked by
  the pipeline, the clip job or the channel scan posted with no hashtags and no
  YouTube tags at all — only the Uploading Center's own button wrote them. Each
  clip now gets tags written from what is actually said in it, falling back to
  the channel keywords the clip mentions when no model is configured.
- **TikTok stops filling your inbox faster than you can empty it.** Every clip
  sent the inbox way waits as a draft until you tap it in the TikTok app, and
  TikTok refuses new uploads once too many are waiting — which is how 37 piled
  up and every TikTok post started failing. The runner now stops at 10 waiting
  drafts (`TIKTOK_INBOX_LIMIT`) and tells you how many are on your phone
  instead of uploading into the refusal. Nothing is lost: the clips keep their
  place and go up once you have cleared the backlog.
- **Segments deep in a stream get their hook words back.** Only the opening of
  a long recording is transcribed, so a segment two hours in had nothing to
  burn over its first seconds and opened on silence — 27 of the segments in the
  library rendered that way. The render now reads the whole recording's
  transcript for a segment, and the review stops calling those openings
  captionless.
- **Car yaps never get booked back to YouTube.** The series is already on the
  channel, so an edit of it re-uploaded spends a daily upload slot to duplicate
  itself (17 had to be pulled by hand once). The scheduler refuses them now and
  says why; the Instagram vertical cut is untouched.

- **The videos you already have move their captions too.** Every existing
  long-form project still carried the old placement, so its next export would
  have burned the words across the middle again; opening one now moves them
  into the subtitle band — unless you dragged them somewhere yourself.
- **Long-form captions read as subtitles again.** Both the hook words and the
  whole-video captions now sit in the lower third of the frame instead of
  across the middle, where they covered the screen-share and your face, and
  captions are on by default on every new project.
- **A long-form video is eight minutes or it isn't one.** Topic segments are
  planned at twelve minutes and never come back under eight, so every segment
  can carry mid-rolls — and the scheduler refuses to book a shorter export as a
  long-form upload (a forty-second one went out as a feature). The editor says
  so on the Export tab before you render.
- **Every segment's opening is reviewed, not just the stream's.** Each topic
  segment is its own upload, so each one is now checked for the hook treatment
  — burned-in words, the push-in, the motion — and the Long-Form list and the
  Hook panel name the segments that open flat.

## 2026-08-21

- **AI writing is free again, and it stops breaking when a model retires.**
  opencode removed the free model the app was pinned to, so every AI feature —
  carousels, titles, ideas, scripts, X posts — had quietly stopped asking a
  model at all and was serving its offline fallback instead. The app now keeps a
  list of free models rather than one name: it tries them in order, drops any
  that has been retired or has hit its daily limit, and only reaches for your
  paid DeepSeek key when every free one is gone. `npm run ai:check` tells you in
  one screen which models are answering right now.

## 2026-08-21

- **Your videos have pictures on them.** The Long-Form Video grid was a wall of
  text, so telling one four-hour stream from another meant reading timecodes.
  Every card now carries a poster: the thumbnail you made if you made one,
  otherwise the best frame the app can find in that recording, picked rather
  than grabbed from one second in.
- **A Thumbnail tab in the Long-Form Editor.** Point it at a segment and it
  reads through that stretch, scores what it sees and keeps the six best shots
  of you — it knows the difference between you talking to camera and a "be right
  back" screen, and it will not offer you one of those. It finds your facecam on
  its own, crops to it and blows it up 8x with proper sharpening, which matters
  because these streams come down at 640x360 and a plain screenshot looks like
  one. Then it writes you three hook lines from what you actually said in that
  segment, lays one over the picture in one of six looks, and saves the result
  beside the video so the card and the upload both have it.

- **Long-form videos now cut the quiet parts about twice as hard.** The dead-air
  pass only ever heard pauses that were quiet AND long, which is why Day 39 came
  out ten and a half minutes shorter than a four-hour recording. Each pace now
  listens with its own ear, and no pause survives longer than a beat: on that
  same Day 39 the Fast pace removes **25 minutes instead of 10m31s** (2,054 cuts
  instead of 576), Relaxed removes 11m34s and Ultra 38 minutes. Nothing can clip
  a word — every cut is still carved out of the middle of a detected pause.
  Switching pace in the editor re-listens to the audio when it has to, instead
  of quietly re-planning from what the old ear heard.
- **The first 30 seconds is the hook now, and it gets treated like one.** It was
  a seven-second window before. Captions ride the whole 30-second block (and
  still stop after it), the frame drifts slowly in across the entire block
  instead of snapping in over half a second, and your video title fades on at
  0:00 and is gone by 0:03. It is all togglable under Hook, and nothing moves
  after 0:30.
- **A weak opening no longer ships quietly.** The first 30 seconds is read and
  scored, and a project whose opening does not earn attention says so on its
  card and in the Hook panel — with the score, the reason, and the words it
  read. When it is weak the editor also points at the strongest sentence
  elsewhere in the take and offers to open on that instead. It never reorders
  anything on its own.

## 2026-08-20

- **The Long-Form Editor opens one segment at a time, not the whole stream.**
  A stream is three to five videos in one recording, but the editor only ever
  showed the full three hours and left the segments on a tab. There is now a
  dropdown across the top of the editor — Full recording, then every segment
  with its runtime and whether it has been rendered — and picking one scopes
  the whole view to it: the player and the scrubber run that stretch and stop
  at its end, the timeline zooms to it with the rest of the stream greyed back,
  and the bar carries **Render this segment**, **Watch** (plays the finished
  file in place of the preview) and **Download**. Every project card on the
  Long-Form Video page lists its segments too, and each one opens straight into
  its own editing view. The Stream Pipeline's segments step now links there
  instead of to the full stream.
- **App demos stopped being cut into "segments" that were really half a video.**
  Segments are for streams: anything under fifteen minutes is now left whole,
  and says so, instead of coming back split in two. The one- and two-segment
  splits already sitting on the short app-demo uploads are cleared out —
  nothing that had been rendered is touched.
- **A second TikTok profile no longer knocks out the first.** Connecting TikTok
  wrote to one shared slot, so a second account overwrote the first account's
  connection — and extra TikTok accounts never posted at all, they just saved
  as manual reminders. Every TikTok account now keeps its own connection,
  profile and avatar, the Connect button appears on each one, and a clip posts
  with the token belonging to the account it was booked to.

- **The TikTok submission has a product page, terms and a privacy policy that
  describe software creators run — not one person's private dashboard.** The
  documents the reviewer read in July opened with "a personal content-operations
  dashboard", which is the exact thing TikTok said it would not approve. They
  are rewritten and live in `site/`, mirrored into `TERMS.md` and `PRIVACY.md`
  so the URLs already registered with TikTok stop contradicting the new ones.
  `docs/TIKTOK-RESUBMISSION.md` now names, claim by claim, which sentences are
  true today and which two are not — the repo is private, so "open source" is
  not yet one of them.

- **The same short stopped being booked to Facebook two, three and five times.** Mirroring in shuffle mode only remembered which time slots a platform already had, not which clips — so any clip it already carried was dealt again into whatever slot was free, and every pass found more. 43 repeat bookings were sitting in the queue. A clip a platform already has is now skipped, and the mirror says so instead of silently doubling the post up.
- **The TikTok audit watcher was watching an app that can never be approved.**
  The client key in `.env` is the sandbox app's, and a sandbox app is unaudited
  by definition — so the four-hourly "still waiting on the TikTok app audit"
  was reporting a fixed answer, not a queue. It now says `SANDBOX` and names
  what is actually missing: the production client key and secret, which is what
  approval would apply to. The docs carry the same correction, so the day the
  review clears, flipping `TIKTOK_AUDITED` alone will not look like a failure.

- **The X mark on a slide is the X mark, not a typed letter X.** It is drawn
  from the logo's own outlines on its 24-unit grid — the wings and counter as
  one shape, the main diagonal as another — so it reads as the brand rather
  than as a placeholder.
- **A deck says how many goes slide 1 took.** When the hook gate throws a draft
  back, the count comes out with the deck instead of being swallowed, so a run
  that needed three attempts at its opening slide is visible afterwards.

- **The still on a carousel slide sits flush with the top and is drawn bigger.**
  A widescreen frame fitted into a 4:5 slide left a band of blurred nothing
  across the top before the picture even started. It now starts at the top edge
  and grows into the space above the copy — up to ten per cent, less on a
  squarer frame, never across the words — which costs a strip off each side
  that was the desk and the wall anyway.
- **Slides are signed with X as well as YouTube.** The foot of every slide now
  reads *Nic Vandewetering* beside the YouTube mark and *@nvandewetering*
  beside an X mark. Both are drawn rather than fetched: an external logo taints
  the canvas and the whole slide then fails to export.
- **Slide headings are set like headlines.** The first letter of every word that
  carries meaning is capitalised, small words in the middle are left alone, and
  a name that already has its own capitals is untouched — CoLateral, OBS and PE
  stay as written, and "11pm" does not become "11Pm".

- A stream whose clips all finished no longer sits on "needs attention" forever. When the server stopped mid-job the clip record kept its error even though every clip was on disk, and Retry could not clear it; it now settles the job. A job that stopped before it planned any clips restarts from the source instead of reporting success and doing nothing.

- **"5 needs you" on the Catching up with YouTube panel now names those five
  videos and gives each one a button.** The count used to be a number with
  nothing behind it: nothing on the screen said which streams were stuck, and
  there was no way to reach them. Each one is now listed with what went wrong —
  "took too long, the scan gave up", "the run broke" — and either **Open it**,
  which goes straight to that run, or **Start it again** for a run that is no
  longer there.

## 2026-08-19

- **You can now tell a clip to post straight to TikTok instead of waiting in
  the inbox for a tap.** The TikTok panel on a clip asks what TikTok requires
  before a direct post — who can see it, whether comments, Duet and Stitch are
  allowed, and whether it promotes a brand — and Schedule stays greyed out
  until those are answered. Interactions your TikTok account has switched off
  show as unavailable rather than being sent anyway, and the answers are
  re-checked against your account at the moment the clip posts. Leave the
  panel alone and nothing changes: the clip goes to your inbox exactly as
  before. Until the app review is approved TikTok only accepts "Only you" for
  a direct post, and anything wider is refused before the upload starts.

- **The TikTok resubmission is written out, so it is a decision rather than a
  project.** `docs/TIKTOK-RESUBMISSION.md` has why the review was refused (two
  reasons, not one — the personal-use framing, and the consent UI TikTok
  requires for Direct Post that the Uploading Center does not have), what has
  to be true before submitting again, the description and review notes to
  paste, the demo video shot by shot, and the portal click-through.
- **Facebook now holds your posts for you — Reels and carousels both.** A short
  or a deck booked for the Page used to sit here until its slot came round and
  only then start uploading — so nothing existed on Facebook until the minute it
  went out, and a missed run was a missed post. Anything whose slot is between
  15 minutes and 28 days away is now handed to Facebook straight away with the
  time on it: a Reel through the finish call, a carousel as unpublished photos
  under a feed post carrying the scheduled time. Facebook publishes it itself,
  and the board says **Scheduled**. At the slot the app checks Facebook actually
  published it and publishes it itself if not, the same follow-through YouTube
  has always had. Four go up per run, so the backlog drains over an evening
  instead of uploading hundreds of posts at once.
  `npm run publish:facebook:verify` proves the whole thing against the real Page
  with one post and no queue involved. If Facebook ever refuses to hold a post,
  it is not failed — it is put back to its slot and published there, the way it
  was before this existed.

- **Booking a stream's outputs now hands them to the platforms straight away.**
  The pipeline used to write everything into the queue and leave it for the
  five-minute runner, so a batch you just booked sat there saying "Queued" with
  nothing actually anywhere. The booking now settles the slots and immediately
  pushes up everything a platform will take early — YouTube gets the upload and
  shows it in Studio as Scheduled. It runs behind the sheet, so booking closes
  as fast as it always did. `publish:enqueue` at the terminal does the same.
- **Every scheduled post shows its own frame.** A card could only show a
  picture when the post came from a clip job whose folder was still around, so
  long-form edits, topic segments, adopted videos and anything queued from the
  CLI drew an empty grey box — which reads as "this booking did not take". A
  poster frame is now pulled from whatever file the post will publish.
- **The board says what a waiting post is waiting for.** "Queued" now only
  appears where it is true: YouTube posts say **Uploading** while the file goes
  up ahead of the slot, and Instagram, TikTok and Facebook — none of which
  accept a future post through their API — say **Posts at slot**, with a
  hover explaining that CoLateral Marketing posts it itself at that time.
- **The six posting times are now evenly spaced, and the queue you already have
  fills them.** The six-a-day grid had a four-hour hole in the afternoon and two
  posts ninety minutes apart on a Saturday morning; every time is now 150
  minutes from the last — weekdays 07:30, 10:00, 12:30, 15:00, 17:30 and 20:00,
  weekends 09:00, 11:30, 14:00, 16:30, 19:00 and 21:30 — so the feed sees you
  six times in six different parts of the day. More slots on their own only
  grow the calendar, though: everything already booked keeps the time the old
  three-a-day grid gave it, so the new slots open up empty and the queue still
  runs to the same date months out. `npm run publish:frontload` is the other
  half — it lifts every upcoming post and deals it back onto the grid from
  tomorrow, in the order it is already in, so the backlog reaches the feed twice
  as fast instead of the calendar growing more places to sit. It shows the plan
  and the new end date first and only writes with `--write`; `--push` also moves
  the videos YouTube is already holding, and tells YouTube.
- **An update in progress now tells you it is still going, and says when it is
  done.** The rebuild stops the server, so for the minutes it takes there is
  nothing left to answer the screen: the banner froze on whatever step it last
  heard about and span there — the same picture at four seconds and at forty
  minutes. It now counts the update up on a clock that keeps running while the
  app is down, says plainly that the app is rebuilding and comes back on its
  own, warns once a build has been going ten minutes, and stops claiming an
  update is on its way after an hour — pointing at update-app.log
  instead. When the app comes back it says so, once, with the build it is now
  running, rather than reloading into a screen that looks identical.
- **A release that wedges no longer takes the app down with it silently.** The
  release writes a heartbeat every 30 seconds through the long build step, so a
  build that has stopped moving is visible instead of looking the same as one
  that is working, and a build still running after 90 minutes — twice what the
  slowest real release here has taken, retry included — is stopped and reported
  rather than leaving the app down indefinitely.
- **An update survives the page that started it.** Reloading, or opening a
  second tab mid-update, used to show no update at all and then reload without
  explanation; every screen now picks up the release the app itself reports.
- **Anything you schedule to Instagram now goes to the Facebook Page as well.**
  The same clip or picture post, the same caption, the same slot, carried on the
  one scheduled post instead of a second one you had to book yourself — so the
  Page keeps up with the Instagram feed without you ticking anything. The
  Uploading Center says so on the picker ("Instagram + Facebook"), and mirroring
  a schedule onto Instagram now mirrors it onto Facebook too. An extra (non-primary)
  Instagram account still posts on its own, since no Page is paired with it.
- **Six posts a day instead of three, and a year of calendar instead of four
  months.** "Every slot in the next four months is taken" was never YouTube
  saying no — it was two numbers hardcoded in this app: three posting times a
  day, and a booking sheet that refused to look past 120 days while
  `publish:shuffle` was happily spreading over two years. Twelve finished shorts
  had nowhere to go because of it. The grid is now yours to set —
  `PUBLISH_SLOT_TIMES`, `PUBLISH_WEEKEND_SLOT_TIMES` and
  `PUBLISH_BOOKING_HORIZON_DAYS` — the Uploading Center draws whatever the
  server books on, and the message you get when a day really is full tells you
  how to make room. The original three times are still in the default set, so
  nothing already scheduled moved.
- **A TikTok clip that TikTok asks you to slow down on is no longer thrown
  away.** When your TikTok inbox is full of uploads still waiting for a tap,
  TikTok refuses new ones — and the runner used to record that as a permanent
  failure, so three clips were discarded rather than sent. It now waits six
  hours and tries again without spending the clip's attempts, and says what
  actually needs doing: open TikTok and clear the drafts sitting in the inbox.
- **The TikTok audit watcher stops implying someone is still reviewing the
  app.** TikTok rejected it on 2026-07-29 — "not approved for personal or
  internal company use" — and the API says exactly the same thing whether a
  review is queued or already refused, so the watcher logged "still waiting"
  for three weeks. `docs/TIKTOK.md` now carries the decision, what still works
  today (clips upload to your TikTok inbox), and what a resubmission has to
  change to get automatic posting.

## 2026-08-18

- **The daily scan no longer takes in a stream while you are still streaming
  it.** A scan that ran mid-stream downloaded the 40 seconds of Day 39 that
  YouTube had published so far, cut two shorts out of that sliver, and wrote the
  stream into its ledger as done — so the finished eight-hour VOD would never
  have been picked up. A stream that has not ended is now skipped and left
  unrecorded, and the next scan takes the whole thing in once you stop.

- **Spotify is signed in and the Podcast page now says which episodes are
  actually live on it.** Connect Spotify once on the Podcast page, point it at
  the show, and every episode in the feed is labelled either **Live on
  Spotify** with a link straight to it, or **waiting for Spotify to pull it
  in** — so there is finally an answer to "did that stream go out" that comes
  from Spotify rather than from the feed. Spotify still has no upload API for
  creators, so publishing keeps happening the way it already did: the app
  hosts the RSS feed and Spotify fetches from it.

## 2026-08-14

- **Emoji are back on your carousels, in the Apple set.** Every slide is set in
  Arial, which has no emoji in it, and the server that renders a booked deck has
  no emoji font at all — so the 🚀 the copy was written around came out as empty
  space on everything that actually got posted, while the preview on your screen
  looked fine. Emoji are now drawn as Apple pictures rather than typed, so a
  slide looks the same whether your browser or the publisher painted it, and it
  is the iOS artwork wherever it lands. Decks already rendered are repainted.
- **Stream stills show the whole frame again, your face included.** A still was
  cropped to fill the slide, which threw away more than half the width of a
  widescreen frame from the middle out — the half your webcam is in. So a slide
  meant to show you working became a zoom into the middle of a screen share with
  your face sliced off the edge. The whole frame now sits above the copy over a
  blurred fill of itself: camera, editor and terminal all in shot together.
- **You can look at a deck before it goes out.** `npm run carousel:proof`
  renders a stored carousel to the exact files the publisher would post and
  prints where they are, next to each slide's words.
- **The Uploading Center stops re-reading the whole publish queue for every
  clip on screen.** Each clip card asked the queue "which of these posts are
  mine?" from scratch — four separate times per card, every time the page drew
  itself, including on every character you typed into a caption. With a real
  queue that was 54 ms of work per keystroke for one run of clips, and it grew
  with the queue: across the whole clip library the same question cost 1.3
  seconds. The answer is now worked out once per queue and looked up, which
  measures 2 ms either way.

## 2026-08-12

- **Your carousels stopped being silently held back.** Confirming the booking
  sheet marked every output that was not ticked as one you had deliberately
  kept back — including the ones that only became bookable while the sheet was
  open. The deck is written from the transcript minutes after the shorts
  finish, so on 17 streams in a row it was recorded as an untick you never
  made, and a held-back output is skipped forever: 26 rendered decks were made,
  rendered, and then never booked. The sheet now says what it actually showed
  you, and anything that lands after it opened is booked as it lands.

## 2026-08-12

- **The app downloads a third of what it used to on every screen.** Every clip
  project's captions - word by word, for all 139 projects - were sent to the
  browser on every page, when only the clip you actually open needs them. The
  Clip Editor now fetches them for the project you open, and refuses to open a
  project whose captions it could not load rather than risk saving over them.
  Nothing else changes: the project list still shows each clip's caption
  count, and captions you have split or re-timed by hand are untouched. The
  page payload went from 2.4MB to 725KB across today's two changes.
## 2026-08-12

- **The home screen says how each stream is doing, not just whether it
  finished.** Every past pipeline in the list now carries a progress bar, what
  it actually produced (shorts, segments, MP3 or podcast, carousel slides,
  posts), and what happened to those outputs on the way out — "10 scheduled ·
  10 uploaded", or "Nothing scheduled yet" on a run that made something and
  booked none of it. Long-form edits, segments and carousels count towards that
  now too: only clips used to be traceable back to the run they came from.
- **And how far behind YouTube it is.** A panel above the list says, per kind of
  video, how much of the last week's channel has been through the pipeline —
  live streams on one line, recorded uploads (the car recordings) on another —
  with the ones that never started listed underneath and a Run it button next to
  each. It reads the picture the nightly scan already took, so it costs no
  YouTube quota; it appears after the next scan, and offers a Scan button until
  then.

## 2026-08-12

- **Every page of the app downloads half a megabyte less.** The brand watermark
  and your profile photo were stored inside the app-data document as text, so
  all 487KB of the watermark was sent to the browser on every screen you
  opened and written back to disk on every change you saved. Pictures already
  went to disk everywhere else in the app; these two were missed. They move
  themselves across the first time the app reads them - nothing to press, and
  they look exactly the same.
## 2026-08-12

- **Booking a run's outputs no longer re-shuffles your whole calendar.** It used
  to re-deal every upcoming post the moment anything was booked — on your queue
  that was 338 of 394 posts moved, one of them from August to November, and it
  ran itself in the background every time a segment finished rendering. It now
  slots the new posts in and leaves everything you had already read exactly
  where it was, still splitting up a stream that lands next to itself.
- **A post can no longer be scheduled against a folder.** The check that a clip
  exists let a directory through, which is how 27 carousel posts ended up
  pointing at `data\carousels\carousel-…` instead of a picture and quietly
  failed one by one at their slots. A folder is refused when you book it, on
  screen, instead of days later in silence.
- **A long-form booking is checked for being a video at all.** Long-form was
  exempted from the Shorts rules, which accidentally exempted it from every
  check — so a broken render booked fine and failed at its slot. Its length and
  its shape are still its own business.
- **Every change to the publish queue is now written down.** `data\publish-queue.log`
  records each post added, removed or moved, with the moment, the folder and the
  thing that did it. When the schedule changes and nothing explains why, that
  file now says who.
- **A pipeline run records each booking as it makes it.** It used to write down
  what it had booked only after the whole batch, so anything that interrupted it
  left posts on the queue that no run admitted to.

## 2026-08-12

- **Double-clicking `Update CoLateral Marketing.bat` works again.** Every release
  run with no arguments died on `unknown revision 'g'` before it changed a
  thing: releasing `main` into `main` left the script with one branch name
  where it expected a list, and PowerShell handed git that name one letter at
  a time. Releases had to be run as `-Branch dev` to get past it.
## 2026-08-12

- **Mixing the schedule can no longer post twice at one instant.** The mixing
  above moved posts by time alone, but several posts legitimately share a time —
  one per platform — so it put two YouTube posts (and two Instagram, and two
  TikTok) on the same instant, 123 times over. It now knows which platform and
  account each post occupies and will not stack two on one lane, and it will not
  put the same recording in two slots running either, instead of hoping a
  shuffle happens to avoid it.
- **`npm run publish:shuffle -- --repair` fixes a live schedule without
  re-ordering it.** It lifts only the posts that are actually double-booked,
  leaves everything else on the time you already read, and never touches a video
  YouTube is already holding. A post with nowhere left to go gets a slot further
  out — the schedule grid runs three slots a day for as long as it is asked
  (`--days`, two years by default), so a platform carrying more posts than the
  days they are booked across is a reason to reach forward, never a reason to
  stack two on one day.
- **A plain `--write` no longer moves videos that are already on YouTube.**
  Moving them in the queue without telling YouTube leaves the two disagreeing,
  and YouTube wins. Only `--push` moves them, because only `--push` sends the
  new time.
- **`npm run publish:adopt` finds videos on the channel the app has never heard
  of.** Thirteen had built up — seven scheduled, six already public — uploaded by
  the pipeline but never recorded, so the runner could not see them and the
  calendar could book straight over them. Adopting one writes a record of what
  YouTube already holds; it never uploads or re-uploads anything.
- **Scrolling through dates in the Uploading Center is instant.** Every arrow
  click used to ask the server for the two weeks it was moving to and grey the
  buttons out until the answer came back — behind whatever else the page had in
  flight, since a browser only opens six connections at a time. The dates are
  arithmetic, so the calendar works them out on the spot: measured at 1.4ms per
  page turn against the real 406-post queue, where the round trip alone was over
  230ms before it queued.
- **The screen no longer waits on YouTube to draw itself.** The first paint was
  gated on reading the live channel schedule, so a slow or unreachable YouTube
  held the whole Uploading Center on a spinner with the local data already
  loaded. The channel now fills in behind the page, and every outward call to a
  platform gives up after 20 seconds instead of holding a connection open
  forever.
- **The app is quicker with dates everywhere.** Placing posts on the calendar
  rebuilt a date formatter for every single post; it now reuses them, which is
  about eight times faster, and the Uploading Center stops rebuilding all four
  platforms' calendars on every keystroke. The sidebar's stream list and the
  needs-attention badge also stop asking the same question twice per page.
- **Scheduled shorts no longer come out in stream order.** Booking a run used
  to dump that recording's clips into the next three time slots, so a week of
  Shorts was the same stream three times a day. Upcoming posts are now mixed
  across the slots they already occupy, and a new booking shuffles itself into
  the pending queue instead of lining up behind the last clip from the same
  recording. Already-uploaded YouTube schedules move with them when you run
  `npm run publish:shuffle -- --write --push`.
- **The Uploading Center title stays put while you scroll.** The top of the
  screen — "Uploading Center", the channel you're connected as and the quota
  meter — is now a frozen pane, and only the clips for the run and the
  calendars move underneath it. Scrolling to the far end of the calendar no
  longer loses the header, and the calendar's own inner scrollbar is gone, so
  there's one scroll on the screen instead of two fighting each other. On a
  short window (under 720px tall) it scrolls the old way, because a pinned
  header there would cost more room than it saves.
- **A calendar short opens that short, not today's leftover project.** Clicking
  a scheduled Short used to switch the Uploading Center to a job — often the
  newest one — and dump you at the top of today. It now opens the queue item
  you clicked: the right platform tab, the two-week window that actually
  contains that day, and the card ringed and scrolled into view. Threads
  packs open that day's pack; Facebook rows open that saved post.
- **Clicking a row on the Master Calendar opens the screen that owns it.**
  Carousel posts used to dump you in the Uploading Center, which only shows
  Shorts. They now open Carousels — and a specific deck when the calendar
  knows which one. Shorts still go to the Uploading Center, Threads to
  Threads, Facebook threads to FB / IG, long-form to Long-Form. The count
  chip ("3 Carousel posts") is the same jump, not just an expand.
- **The long-form video of every stream can be scheduled again.** Booking a
  run's outputs refused the full-length edit with "this clip is 352s long — trim
  it below 3 minutes", because the Shorts length rule was being applied to it —
  a rule about Shorts, checked against a video that was never going to be one.
  Long-form edits and topic segments now book as ordinary YouTube uploads,
  whatever their length and whatever shape they were rendered in; clips posted
  as Shorts are still held to the three-minute limit.

- **A long-form video can be booked to a time you choose, not just the next
  free slot.** Scheduling one straight through the publish API still refused it
  on the Shorts length rule, because the API had no way to say "this is the
  long video" — only the pipeline's own booking sheet could. It can now, so a
  full-length edit can be placed on a specific day and time, in its own lane,
  without competing with the shorts.

- **Opening a stream on the pipeline page now follows you down the sidebar.**
  Clicking a past run set what was on screen but not what the app said you were
  working on, so every Formats screen kept naming the stream before it. Starting
  a stream, restarting one, and opening one all set it now.
- **The Customise lines tell the truth about what is hidden.** A pasted import
  link no longer disappears when the panel closes on Long-Form, the Carousels
  line says whether your photos have a description, the Uploading Center stops
  repeating itself above the panel and can no longer push "all captioned" off the
  end behind a row of hashtags, and the X / Threads line says what the buttons
  inside do instead of restating autopilot twice.
- **The browser tab now says the same words as the sidebar** on X / Threads Posts
  and FB / IG Threads.

## 2026-08-12

- **Facebook Reels actually publish now.** The previous release got the video
  to Facebook for the first time — the page had never received a single byte —
  but the last step still did not fire: the adapter waited for Facebook to say
  `ready`, and a transferred file reports `upload_complete` and sits there,
  because processing only starts once we ask it to publish. So every clip
  uploaded, waited, gave up and uploaded again. It now treats a finished
  transfer as finished and posts it.

## 2026-08-12

- **Facebook posts again, and it stops holding up everything else.** Nothing
  has reached the Page since 5 July: the app was opening an upload with
  Facebook and then never handing the video over, because the file was named in
  the wrong step of Meta's flow — so fifteen Reels sat "uploading" for up to
  eight days, and the publish runner spent about an hour of every run staring at
  them while YouTube and Instagram waited behind it (yesterday's 11:30 Instagram
  post went out at 22:50). The video is now transferred the way Meta's API
  actually wants it, an upload that has gone nowhere for two hours is declared
  dead — dropped and sent again from scratch instead of resumed forever — and no
  single run may spend more than three minutes waiting on Facebook. A Facebook
  upload that keeps failing now shows up on the board as a failed post with
  "Facebook took the upload and then never fetched the video", not as silence.

## 2026-08-11

- **Booking a back catalogue no longer stops at a full three weeks.** Scheduling
  a run only ever looked three weeks ahead, so once the queue was full — which a
  handful of streams does on its own — every output came back "no free slot"
  while months of empty calendar sat just past the edge. It now reaches four
  months out. Nothing else changed: still one output per slot, still nothing on
  the day it was booked, and a run that genuinely does not fit is still refused
  rather than stacked on top of what is already there.

## 2026-08-11

- **Every working screen now opens on one obvious action.** Short Clips, the
  Uploading Center, Carousels, Long-Form, the Clip Editor and both posting
  screens used to greet you with a row of equally weighted buttons and half a
  dozen questions before anything could happen. Each now leads with the one
  thing you came to do — Find clips, Book this run, Write today's posts, add a
  recording — and everything else sits behind **Customise**, closed, with a
  summary line saying what is set so the defaults are never a surprise.
  Nothing was removed and no scheduling, clipping or posting logic changed.
- **Each screen says which stream it is about.** Open Carousels or the editor
  from a pipeline run and the header names that recording and carries it down
  the flow, instead of leaving you to recognise it from a filename.

- **A shaky connection no longer posts the same clip to YouTube several times.**
  On 10 August a network wobble turned one batch of clips into 14 public
  Shorts, because every retry uploaded the video again from scratch. The
  uploader now remembers the upload it started and picks that one back up, so a
  dropped connection resumes instead of creating a second video. If two publish
  runs ever overlap, the later one now stands down rather than posting
  everything a second time.
- **`npm run publish:reconcile` finds videos the app lost track of.** It lists
  anything on the channel the queue has no record of — like the ones that burst
  created — and `--write` records the matches it is sure about.

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
  window reads "(1) CoLateral Marketing" — so a stage that failed while the app sat
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

- **Double-clicking `Update CoLateral Marketing.bat` releases what is actually
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


- **You can talk to CoLateral Marketing for nothing.** A "Talk to it" card on
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

- **You can talk to CoLateral Marketing.** `/agents` opens a live speech-to-speech
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
- **CoLateral Marketing opens as a desktop app.** `CoLateral Marketing.bat`, a Desktop
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
