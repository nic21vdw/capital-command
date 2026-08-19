# Resubmitting the TikTok app review

Companion to [TIKTOK.md](TIKTOK.md), which records the state. This one is the
work: what has to become true, the copy to paste, the video to record, and the
buttons to click.

## Read this part first

The review was rejected for one stated reason, but there are **two** things
wrong, and fixing only the stated one gets a second rejection.

**1. The submission described a tool for one person's own accounts.** The
reviewer's note: *"App will not be approved for personal or company internal
use."* This is not only the description field. The Terms of Service and
Privacy Policy URLs submitted with the app both open with the sentence
"Capital Command is a personal content-operations dashboard, built and run by
…" — the reviewer read that. The registered website was a raw GitHub file, and
the only redirect URI was `http://localhost:3000/api/auth/tiktok/callback`. All
three say *internal tool* on their own.

**2. The app does not implement the UX TikTok requires for Direct Post.**
Review never reached this, and it fails independently of the framing. TikTok's
content sharing guidelines make the following mandatory before a direct post,
and the Uploading Center has almost none of it:

| Required | Today |
|---|---|
| Creator's nickname shown, so it is clear which account is being posted to | shown in the account switcher — the one requirement already met |
| A privacy dropdown with **no default**, options taken from `creator_info` | never asked — `use-uploading-center.ts` enqueues with `visibility: "public"` hardcoded |
| Comment / Duet / Stitch toggles, all **off** by default, greyed out where the creator disabled them | never asked — the adapter sends `disable_duet/comment/stitch: false` unconditionally |
| Commercial-content disclosure (Your brand / Branded content), off by default | absent |
| The matching compliance line (Music Usage Confirmation, plus Branded Content Policy when that is selected) | absent |
| A preview of what is about to be posted, and explicit consent | the clip card is close, but consent is implicit |
| `creator_info` queried before every direct post | queried for the profile display only, not in the publish path |

None of that matters while the app is unaudited — the inbox flow has no
privacy or interaction settings of its own, which is exactly why TikTok allows
it. All of it matters the moment Direct Post is the ask.

## What sandbox does not solve

Sandbox mode exists to test without review, and it does not lift this: it has
no access to the Content Posting API for public videos. Unaudited direct posts
are restricted to private viewing whatever environment they run in. There is
no route to a public automatic post that skips approval.

## The fork

**Lane A — stay as you are.** Clips keep uploading to the TikTok inbox and you
finish each one with a tap. Nothing to build, nothing to submit, no risk. The
cost is the tap, and the backlog that throttles uploads when the inbox grows.

**Lane B — become a product and resubmit.** Everything below. The cost is real
work, and TikTok has to believe a creator who is not you can use this.

Do not submit Lane B until the checklist is honestly complete. A second
rejection on the same grounds is worse than not submitting — the reviewer sees
the history.

## Lane B checklist — must be true before you submit

1. **A real domain serving a real product page.** Not a raw GitHub URL. The
   page describes what creators get and how to connect their account.
2. **Terms and Privacy rewritten and hosted on that domain.** They currently
   declare personal use in their first line. That line has to go, and what
   replaces it has to be true of the product.
3. **A redirect URI on that domain**, registered in the portal alongside
   localhost. A reviewer who only sees `localhost` sees an internal tool.
4. **The Direct Post consent panel built** — the whole table above: privacy
   dropdown with no default from `creator_info`, three interaction toggles off
   by default and disabled where the creator's own settings disable them, the
   commercial-content disclosure, the compliance line, the preview and the
   explicit post button. `creator_info` queried before each direct post.
5. **A creator who is not you can connect and post.** If that is not true, the
   description in the next section is not true either, and this is Lane A.

Steps 1–3 are copy and DNS. Step 4 is the build. Step 5 is the honest test.

## The copy

Paste these once the checklist is true. **If any sentence is not true when you
read it, change the app or change the sentence — do not submit it as-is.**

### Description (max 120 characters)

> Creators connect their TikTok account, then schedule long-video clips to post
> to it automatically.

*(98 characters.)*

### App review notes (max 1000 characters)

> Capital Command turns a creator's long-form video into short clips and posts
> them to the accounts they connect, on a schedule they set.
>
> Login Kit + user.info.basic: the creator connects their TikTok account with
> OAuth. We read display name, avatar and username only, to show which account
> is connected and label each scheduled post.
>
> Content Posting API + video.publish: after the creator picks the privacy
> level, interaction settings and commercial-content disclosure on our export
> screen (options queried from creator_info, nothing preselected), we direct
> post the clip at the scheduled time.
>
> Content Posting API + video.upload: creators who prefer to caption in TikTok
> choose "send to inbox", and the clip arrives as a draft to finish there.
>
> Changes in this version: the product is hosted at <DOMAIN> with its own terms
> and privacy policy; the export screen implements the required consent UX; a
> redirect URI on <DOMAIN> replaces the localhost-only setup.

*(975 characters with a 15-character domain substituted twice, so there is
room for a longer one. The portal counts as you type — trim the last paragraph
first if it overruns.)*

## Scope audit

All three requested scopes are used. None should be dropped, and each has to
appear in the demo video or the review is delayed.

| Scope | Used by | Where in the video |
|---|---|---|
| `user.info.basic` | `GET /v2/user/info/` in `tiktokAuth.ts` — display name, avatar and username for the connected-account chip | Shot 3 |
| `video.publish` | Direct Post init in `adapters/tiktok.ts`, and the `creator_info` query behind the consent panel | Shots 5–7 |
| `video.upload` | Inbox init in the same adapter — the pre-approval path, and the creator's "send as draft" option | Shot 8 |

## The demo video

One take, 90–120 seconds, screen recording at 1080p with the cursor visible.
No cuts that hide a step — a cut where a decision happens reads as something
hidden. Narrate with captions or voice; silence makes the reviewer guess.

The domain in the address bar must match the website registered for the app,
in every shot. This is the most common cause of a repeat rejection.

| # | Shot | What must be on screen |
|---|---|---|
| 1 | Product page at `<DOMAIN>` | The public page, address bar visible. Two seconds is enough — it establishes that this is not localhost. |
| 2 | Sign in, open the Uploading Center | The app's own UI on the same domain. |
| 3 | **Connect TikTok** | Click it; the TikTok OAuth consent screen appears with the scopes listed; authorize; land back in the app with the account chip showing avatar, display name and @handle. That is `user.info.basic`, on camera. |
| 4 | Pick a clip | The clip card with its video preview and caption — the "preview of the to-be-posted content" the guidelines require. |
| 5 | Open the export panel | Privacy dropdown **unselected**, interaction toggles **all off**, commercial-content toggle **off**. Hold two seconds so the defaults are legible. |
| 6 | Fill it in | Choose a privacy level, turn on one interaction toggle, show a toggle greyed out because the creator's TikTok settings disable it, then turn on the commercial-content disclosure and let the compliance line appear. |
| 7 | Post | Click post, show the confirmation, cut to the TikTok profile with the post live. That is `video.publish`, end to end. |
| 8 | The draft path | Back in the app, choose "send to inbox" on another clip, then show the TikTok inbox notification and the draft waiting there. That is `video.upload`. |
| 9 | The schedule | The calendar with clips booked into future slots, to show what "automatically" means. |

Record it after the checklist is true, not before — the video is the claim.

## Clicking through the portal

1. [developers.tiktok.com/apps](https://developers.tiktok.com/apps) → **Capital
   Command** (app ID `7667654582432024593`). It opens on **Not approved**.
2. **Return to Draft**, top right. Nothing is editable until that is clicked.
3. **Basic information**: replace the Description, point Terms of Service URL
   and Privacy Policy URL at the hosted pages on `<DOMAIN>`, and set the
   Web/Desktop URL to `<DOMAIN>` itself instead of the README.
4. **Products → Login Kit → Redirect URI**: add
   `https://<DOMAIN>/api/auth/tiktok/callback`. Keep the localhost one — the
   local app still uses it.
5. **Products → Content Posting API**: Direct Post stays enabled. Leave
   *Verify domains* alone unless you switch to `TIKTOK_UPLOAD_MODE=url`;
   `FILE_UPLOAD` needs no verified domain.
6. **Scopes**: `user.info.basic`, `video.publish` and `video.upload` all stay
   checked, per the audit above.
7. **App review**: paste the review notes, delete the old `tiktok-demo.mp4`,
   upload the new recording.
8. **Submit for review**, then confirm the History tab reads *Under review* —
   if it does not, the submission did not go through.
9. Leave `npm run tiktok:watch` registered. It logs every four hours and puts
   `TIKTOK-APPROVED.txt` on the Desktop the moment Direct Post opens. It
   cannot see a rejection, so check the portal yourself after a week.
10. On approval: set `TIKTOK_AUDITED=true` in the production `.env` and
    restart. The adapter switches to Direct Post on its own.

Reviews have come back anywhere from a day to a fortnight. The last one took
under 24 hours — a no is fast.
