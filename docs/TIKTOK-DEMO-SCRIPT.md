# The TikTok demo video, line by line

The shot list in [TIKTOK-RESUBMISSION.md](TIKTOK-RESUBMISSION.md) says what has
to be on screen. This says what to do and what to say while it is, in order,
timed to one take of about 110 seconds.

Read it aloud or caption it. Silence makes the reviewer guess, and a guess on
an app that has been rejected once is a second rejection.

## Why this cannot be recorded for you

An agent can drive the app and capture frames — that part works. It cannot
produce this video, because the three shots that demonstrate the three scopes
are all closed to it: shot 3 is an OAuth sign-in to your account, shot 7 needs
a Direct Post that the sandbox key refuses and a Schedule click that books real
posts, and shot 8 needs the TikTok app on your phone. What is left is scenery,
and a synthetic capture with no cursor is exactly what a reviewer looking for
evasion would notice.

## Before you press record

| Check | Why |
|---|---|
| `https://nic21vdw.github.io/capital-command/` loads | Shot 1. It is the address registered against the app. |
| `http://localhost:3000` loads | It was down on 2026-08-22 after the repository moved out of OneDrive. |
| Dismiss the update banner | "An update is ready — 14 changes waiting" sits across the top of every screen and will be in frame. Dismiss it, or release first. |
| Collapse the sidebar | The `<` at the top of it. `/finance`, `/holdings`, `/goals` and `/notes` are one scroll away and none of them belong in a video a stranger reviews. |
| **Clear the TikTok inbox** | TikTok is holding its maximum of unfinished drafts. Until they are posted or discarded, shot 8 fails on camera. |
| Set **Customise → FOR THIS RUN** to include TikTok | The consent panel only mounts when TikTok is a target. With the run on YouTube alone there is nothing to film in shots 5 and 6. |
| 1080p, cursor visible, one take | No cut where a decision happens. |

## The take

**Shot 1 — the product page (0:00–0:12)**

On `nic21vdw.github.io/capital-command`, address bar visible. Scroll to "What
the TikTok connection does" and hold.

> "Capital Command is self-hosted software for creators. Each creator installs
> their own copy and connects their own accounts. This page lists exactly what
> the TikTok connection asks for and what each permission does."

**Shot 2 — the app (0:12–0:20)**

Switch to `localhost:3000`, Uploading Center, sidebar collapsed.

> "This is my own installation, running on my machine. The clips, the schedule
> and the tokens never leave it."

**Shot 3 — connect TikTok (0:20–0:38)** · `user.info.basic`

Click **Connect TikTok**. Let the TikTok consent screen appear with the scopes
listed. Authorize. Land back on the account chip showing avatar, display name
and handle.

> "The creator connects their own TikTok account. We read display name, avatar
> and username, and we use them for exactly one thing — showing which account
> is connected and labelling each scheduled post."

**Shot 4 — a clip (0:38–0:46)**

A clip card, video preview and caption visible.

> "Here is a clip cut from a long-form video, with the caption that will go
> with it. This is the preview of what is about to be posted."

**Shot 5 — the panel opens (0:46–1:00)** · `video.publish`

**Customise**, then **Post straight to my profile**. Hold two seconds without
touching anything.

> "Nothing is preselected. The audience is unset, comments, Duet and Stitch are
> all off, and the commercial-content disclosure is off. These options come
> from creator_info, which we query for this account before every post."

**Shot 6 — the creator answers (1:00–1:22)**

Choose an audience. Turn on one interaction toggle. Point at one that is greyed
out. Turn on the disclosure and let the compliance line appear.

> "I choose who can see it, which interactions are allowed — this one is greyed
> out because it is switched off in my TikTok settings, so we do not send it —
> and whether the post promotes anything. Turning that on shows the matching
> compliance statement."

**Shot 7 — the gate, and the wall (1:22–1:38)**

With every answer filled in, hold on **Schedule** becoming enabled. Click it
and let TikTok's answer appear verbatim.

> "Schedule stays disabled until every one of those answers is given — the app
> will not post without them, and it checks again on the server and once more
> before the upload. Direct Post itself is built and waiting on this review:
> from an unaudited client TikTok refuses it, and that is the refusal."

Do not stage a post TikTok did not accept. The refusal is the honest shot and
the enabled button is the part the guidelines are about.

**Shot 8 — the draft path (1:38–1:52)** · `video.upload`

Another clip, **Send to my TikTok inbox**. Show the notification on the phone
and the draft waiting in TikTok.

> "Creators who would rather caption inside TikTok send the clip as a draft
> instead, and finish it there. That is the path this app uses today."

**Shot 9 — the schedule (1:52–end)**

The calendar with clips in future slots.

> "Once approved, these go out on the schedule the creator set, from their own
> machine."

## After the take

Watch it once for the sidebar, the update banner, and any private screen in a
reflection or a tab title. Then follow "Clicking through the portal" in
[TIKTOK-RESUBMISSION.md](TIKTOK-RESUBMISSION.md) — the description, the
995-character review notes and the three URLs are written out there.
