# The TikTok demo video, shot by shot

The shot list in [TIKTOK-RESUBMISSION.md](TIKTOK-RESUBMISSION.md) says what has
to be on screen. This says what to click and what to say while it is, in order,
timed to one take of about three minutes. Every on-screen string below is the
literal text the app shows, taken from the code, so the reviewer can match it
against TikTok's own Direct Post guidelines.

Read it aloud or caption it. Silence makes the reviewer guess, and a guess on an
app that has been rejected once is a second rejection.

## Why this cannot be recorded for you

An agent can drive the app and capture frames. It cannot produce this video:
shot 3 is an OAuth sign-in to your account, shot 12 books a post to your real
TikTok profile, and shot 13 needs the TikTok app on your phone. A synthetic
capture with no cursor is also exactly what a reviewer looking for evasion would
notice.

## Before you press record

| Check | Why |
|---|---|
| `https://nic21vdw.github.io/capital-command/` loads | Shot 1. It is the address registered against the app. |
| `http://localhost:3000` loads | It was down on 2026-08-22 after the repository moved out of OneDrive. |
| `.env` still holds the sandbox key (`sbaw…`) | TikTok requires an app that has never been approved to be demonstrated from the sandbox environment. Leave `TIKTOK_AUDITED` unset. |
| Dismiss the update banner | "An update is ready" sits across the top of every screen and will be in frame. |
| Collapse the sidebar | The `<` at the top of it. `/finance`, `/holdings`, `/goals` and `/notes` are one scroll away and none belong in a video a stranger reviews. |
| **Clear the TikTok inbox** | TikTok holds a maximum of unfinished drafts. Until they are posted or discarded, shot 13 is refused on camera. |
| In TikTok, switch one of Comments, Duet or Stitch to the most restrictive setting | The panel greys out whatever `creator_info` says is off. Shot 8 needs one greyed-out toggle on screen. Making the account private switches off Duet and Stitch by itself. |
| Clip Editor: Watermark **off** on the clips you film | TikTok's rules forbid adding a promotional watermark. It is off by default; check the two clips you use. |
| Set **Customise → FOR THIS RUN** to include TikTok | The panel only mounts when TikTok is a target. |
| Pick a clip with a caption already written and a free slot | Shots 4 and 12. |
| Decide the ending of shot 12 | See "Two endings" under shot 12. |
| 1080p, cursor visible, one take, under 50 MB | The portal takes up to five videos of 50 MB each. About 1.8 Mbps keeps three minutes under the cap; if it still runs over, split at shot 8 into two videos that each open on the registered address. |

## The take

**Shot 1: the product page (0:00 to 0:12)**

On `nic21vdw.github.io/capital-command`, address bar visible. Scroll to "What
the TikTok connection does" and hold on the permissions table.

> "CoLateral Marketing is self-hosted software for creators. Each creator runs
> their own copy and connects their own accounts. This page lists exactly what
> the TikTok connection asks for and what each permission does."

**Shot 2: the app (0:12 to 0:20)**

Switch to `localhost:3000`, Uploading Center, sidebar collapsed.

> "This is my own installation, running on my machine. The clips, the schedule
> and the tokens never leave it."

**Shot 3: connect TikTok (0:20 to 0:40)** · `user.info.basic`

Click **Connect TikTok**. Let the TikTok consent screen appear with the scopes
listed. Authorize. Land back on the account chip showing the avatar and
"Connected as" the display name.

> "The creator connects their own TikTok account with Login Kit. We read display
> name, username and avatar, and use them for one thing: showing which account
> is connected and labelling each scheduled post."

**Shot 4: a clip, its preview and its title (0:40 to 0:58)**

On a clip card, hover the thumbnail so it plays, then click it to open the
player. Close it. Click into the title box and change a word, then open
**Customise** and show the caption box.

> "This is the preview of the video that will be posted. The title and caption
> are mine to edit before anything is sent, and nothing is added to the video:
> no watermark, no logo."

**Shot 5: Post straight to my profile (0:58 to 1:12)** · `video.publish`

Choose **TikTok** as the platform. In the TikTok box, click **Post straight to my
profile**. Wait for "Reading what this TikTok account allows…" to finish. Hold on
the line that reads **Posting to** the nickname, with the avatar beside it and
"videos up to …" at the end.

> "Before this panel is drawn we ask TikTok what this creator may do, using
> creator_info. It shows whose account this is, with their nickname and avatar,
> and the longest video the account can post."

**Shot 6: nothing is preselected (1:12 to 1:25)**

Without touching anything, hold two seconds. The audience reads "Who can see this
post…", Allow comments, Allow Duet and Allow Stitch are unticked, "Content
disclosure setting" is off, and the consent box is unticked. Hover **Schedule**:
its tooltip reads "Choose who can see this post." An amber line saying the TikTok
app review has not been approved will be on screen. Leave it; it is true, and the
reviewer already knows.

> "Nothing is preselected. The audience is unset, comments, Duet and Stitch are
> off, the content disclosure is off, and I have not yet agreed to anything.
> Schedule is disabled and says why."

**Shot 7: the audience comes from TikTok (1:25 to 1:35)**

Open the audience dropdown and read the options aloud. Choose **Everyone**.

> "These are the audiences TikTok returned for this account and no others. I have
> to choose one myself; there is no default."

**Shot 8: interactions follow creator_info (1:35 to 1:47)**

Tick **Allow comments**. Point at the greyed-out toggle, which reads "(off in
your TikTok settings)".

> "Interactions start off and I turn them on myself. This one is greyed out
> because it is switched off in my TikTok settings, so the app cannot send it
> as on."

**Shot 9: commercial content disclosure (1:47 to 2:15)**

1. Tick **Content disclosure setting**. Nothing else is ticked. Hover **Schedule**:
   "You need to indicate if your content promotes yourself, a third party, or
   both." Hold on it.
2. Tick **Your brand**. The line "Your video will be labeled as 'Promotional
   content'" appears.
3. Tick **Branded content**. The line changes to "Your video will be labeled as
   'Paid partnership'" and the declaration changes to "By posting, you agree to
   TikTok's Branded Content Policy and Music Usage Confirmation." Open the
   audience dropdown: **Only you** is disabled, and hovering it reads "Branded
   content visibility cannot be set to private."
4. Untick **Branded content**.

> "Commercial content disclosure is off by default. Switched on with nothing
> chosen, the app will not let me post, and it says what it needs. Your brand
> labels the post Promotional content. Branded content labels it Paid
> partnership, adds TikTok's Branded Content Policy to what I agree to, and
> removes the private option, because branded content cannot be private."

**Shot 10: the declaration and my consent (2:15 to 2:32)**

Untick **Content disclosure setting**. Choose **Only you** as the audience (the
sandbox key only posts privately). Hold on "By posting, you agree to TikTok's
Music Usage Confirmation." and the line "After it posts, TikTok can take a few
minutes to process the video before it shows on your profile." Tick the box "I
agree to this video being uploaded to … on TikTok at the time I schedule." Pick a
slot. Hold on **Schedule** becoming enabled.

> "The Music Usage Confirmation is shown on every post, disclosed or not. Nothing
> is sent to TikTok until I tick this box, and Schedule stays disabled until I
> have. TikTok can take a few minutes to show the post, and the app says so.
> Changing any answer after this clears the tick, so my consent always matches
> what is on screen."

**Shot 11: schedule it (2:32 to 2:40)**

Click **Schedule**. The clip shows as booked.

> "Nothing has gone to TikTok yet. The video is uploaded at the slot I chose, and
> creator_info is asked again first, so a setting I have since switched off in
> TikTok is not overridden."

**Shot 12: the post (2:40 to 2:58)** · `video.publish`

Open the board, find the booking, click **Publish now** and confirm.

Two endings. Use the one that happens, and say which it is.

- **Public TikTok account (the sandbox default).** TikTok refuses Direct Post
  from an unaudited client and the board shows the refusal text,
  `unaudited_client_can_only_post_to_private_accounts`. Hold on it.

  > "This app is still in TikTok's sandbox, so TikTok will not accept a direct
  > post from it yet. Everything you have just seen is what this review is
  > asking you to approve."

- **Private TikTok account.** The refusal name says the account must be private.
  If you set the account private in TikTok before recording, the post should be
  accepted as a private post, and the board status goes to published. Hold on it,
  then show the post on the TikTok profile. Duet and Stitch are greyed out in
  shot 8 for free in this case, because a private account has them off. This
  ending has not been tried; do not film it as a promise.

  > "The sandbox only allows private posts, so this appears on my profile visible
  > only to me. Once approved, it appears with the audience I chose."

Do not stage a post TikTok did not accept.

**Shot 13: the draft path (2:58 to 3:12)** · `video.upload`

Another clip, **Send to my TikTok inbox**. Show the notification on the phone and
the draft waiting in TikTok.

> "Creators who would rather caption inside TikTok send the clip as a draft
> instead, and finish it there. That is the path this app uses today."

**Shot 14: the schedule (3:12 to end)**

The calendar with clips in future slots.

> "Once approved, these go out on the schedule the creator set, from their own
> machine."

## Where each guideline appears

| TikTok guideline | Shot |
|---|---|
| 1a Latest creator info; creator's nickname shown | 5 |
| 1b Stop if the creator cannot post right now | not filmable; the panel says "…cannot post to TikTok right now… Try again later." (`tiktokPost.ts:95-105`), covered by `tiktokPost.test.ts` |
| 1c Video length against `max_video_post_duration_sec` | 5 shows the limit; enforcement is in `tiktokPost.ts:163` and `adapters/tiktok.ts:291-322` |
| 2a Title can be entered or edited | 4 |
| 2b Privacy options from creator_info, no default | 6, 7 |
| 2c Comment, Duet, Stitch off, greyed out where disabled | 6, 8 |
| Music Usage Confirmation before the publish button | 10 |
| 3a Content disclosure off; Your brand and Branded content; labels; publish blocked with nothing ticked | 9 |
| 3b Branded content cannot be private | 9 |
| 4 Compliance declarations | 9, 10 |
| 5a Preview | 4 |
| 5b No watermark; editable preset text | 4 |
| 5c Nothing sent until explicit consent | 10, 11 |
| 5d Processing-time notice | 10 |
| 5e Status polling | 12 |
| `user.info.basic`, `video.publish`, `video.upload` (app review, not the Direct Post guidelines) | 3, 5 to 12, 13 |

These are on screen too, but they are this app's own choices and not TikTok rules, so
do not describe them to the reviewer as requirements: the creator's avatar beside the
nickname (shot 5), Schedule held until `creator_info` has answered (shot 5), and the
inbox draft route (shot 13).

## After the take

Watch it once for the sidebar, the update banner, and any private screen in a
reflection or a tab title. Check the file is under 50 MB. Then follow "Clicking
through the portal" and "Submission" in
[TIKTOK-RESUBMISSION.md](TIKTOK-RESUBMISSION.md): the description, the
984-character explanation and the three URLs are written out there.
