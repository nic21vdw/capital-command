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
"CoLateral Marketing is a personal content-operations dashboard, built and run by
…" — the reviewer read that. The registered website was a raw GitHub file, and
the only redirect URI was `http://localhost:3000/api/auth/tiktok/callback`. All
three say *internal tool* on their own.

**2. The app did not fully implement the UX TikTok requires for Direct Post.**
An audit against TikTok's current
[Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)
(Direct Post, "Required UX Implementation in Your App"), read on 2026-10-13, found
the consent panel was most of the way there and still short on thirteen of the twenty-one rows below.
The earlier claim in this file that all seven rows "hold" was checked against the
panel and not against the guidelines' own wording, which is how the Music Usage
Confirmation, the avatar, the duration limit and the explicit-consent step were
missed. The table below is the corrected check. Every row cites the code, and
every missing or partial row now has a test that fails without the fix.

Line numbers in **Before** are at `fcce94ac` (`main` when this work started);
**Now** is this branch.

| # | Requirement (guideline) | Before: UI and code | Was | Now |
|---|---|---|---|---|
| 1 | Latest `creator_info` read when the Post to TikTok panel renders (1a) | `tiktok-consent.tsx:38-59` asked once per account per page load and kept the answer until reload | partial | `use-tiktok-creator-info.ts:11,33` reuses an answer for 30 s only (the endpoint allows 20 calls a minute per token), so each panel render is fresh |
| 2 | Creator's nickname shown (1a) | `tiktok-consent.tsx:177` "Posting to {nickname} (@handle)"; `account-switcher.tsx:84-91` | done | `tiktok-consent.tsx:166` |
| 3 | Creator's avatar shown | `creator_avatar_url` was parsed (`tiktokPost.ts:48,75`) and never drawn in the panel; only the switcher showed the mirrored copy | missing | `tiktok-consent.tsx:159-161` draws the link `creator_info` just returned (it expires after 2 hours, hence row 1), with an icon if there is none |
| 4 | Stop and say "try again later" when the account cannot post right now (1b) | `tiktokPost.ts:63-82` never read `error.code` in the 200 body, so `spam_risk_too_many_posts`, `reached_active_user_cap` and `spam_risk_user_banned_from_posting` read as an empty account | missing | `tiktokPost.ts:34-48,96-108` raise `CreatorCannotPostError`; `adapters/tiktok.ts:341-346` defers 12 h or 1 h, or fails for good when banned; `creator-info/route.ts:26-31` answers 429 or 403; the panel says so at `tiktok-consent.tsx:152` |
| 5 | Clip length held to `max_video_post_duration_sec` (1c) | read into `maxVideoSeconds` (`tiktokPost.ts:80`) and used nowhere | missing | `tiktokPost.ts:165` for the panel and Schedule (`clip-card.tsx:347`, using the clip's length); `adapters/tiktok.ts:327-349` measures the real file with ffmpeg at post time |
| 6 | A title the user can enter or edit (2a) | `clip-card.tsx:450-463` title box and `:525` caption box; sent as the TikTok title by `adapters/tiktok.ts:221-238` | done | unchanged |
| 7 | Privacy dropdown from `privacy_level_options`, no default (2b) | `tiktok-consent.tsx:181-195` opens on "Who can see this post…" | partial: with an empty list from TikTok it fell back to all four audiences (`:125-128`) and the offered-audience check was skipped (`tiktokPost.ts:104`) | the dropdown lists only what TikTok returned (`tiktok-consent.tsx:181`); an empty list is a blocker (`tiktokPost.ts:153`) |
| 8 | Comment, Duet, Stitch off by default; greyed out where `creator_info` disables them (2c) | `tiktok-consent.tsx:197-219`; defaults in `tiktokPost.ts:85-94`; `disable_*` sent unless ticked, `adapters/tiktok.ts:233-235`; stale answers dropped by `reconcileWithCreator` | done | unchanged |
| 9 | Content disclosure switch off by default; "Your brand" and "Branded content" tick boxes, either or both (3a) | `tiktok-consent.tsx:221-239` | partial: switching it on ticked "Your brand" for the creator (`:224`), so "on with nothing chosen" could not exist | new `disclosure` flag (`types.ts:129`); `tiktok-consent.tsx:215-240` switching on ticks nothing |
| 10 | Label text: 'Promotional content', 'Paid partnership', both gives 'Paid partnership' (3a) | `tiktok-consent.tsx:242` "Your post will be labelled …" | partial: wording | `tiktokPost.ts:213` returns TikTok's sentence; shown at `tiktok-consent.tsx:242` |
| 11 | Publish disabled while the switch is on and nothing is ticked, hover text "You need to indicate if your content promotes yourself, a third party, or both." (3a) | not expressible, see row 9 | missing | `tiktokPost.ts:168`, so Schedule's tooltip (`clip-card.tsx:598-603`), `route.ts:179` (400) and the adapter all carry it |
| 12 | Branded content cannot be private: disable "Only you" with hover text, or switch the audience (3b) | `tiktokPost.ts:107` returned a message; nothing was disabled | partial | `tiktokPost.ts:189` disables "Only you" with "Branded content visibility cannot be set to private." (`tiktok-consent.tsx:181-188`); `:193` disables "Branded content" while "Only you" is chosen |
| 13 | Declaration before the publish button: Music Usage Confirmation always, plus Branded Content Policy when Branded content is ticked (2, 4) | `tiktokPost.ts:120-126` returned nothing unless a disclosure was on | partial: absent on an undisclosed post | `tiktokPost.ts:202` always returns one; `tiktok-consent.tsx:76-89,244` shows it with links to TikTok's two pages |
| 14 | Preview of the content to be posted (5a) | `clip-card.tsx:437-443` with `clip-preview.tsx:23`: plays on hover, opens a player on click | done | unchanged |
| 15 | No promotional watermark; preset text editable (5b) | Clip Editor watermark is opt-in, off by default (`clipping/export.ts:196`, `clipping/types.ts:55`); title and caption editable | done | unchanged. Leave the Clip Editor's Watermark off on any clip bound for Direct Post |
| 16 | Nothing sent to TikTok until the user explicitly consents (5c) | `tiktok-consent.tsx:152` stamped `consentedAt` when the radio was selected, and nothing read it (`route.ts:178`, `adapters/tiktok.ts:329`) | partial: a timestamp for a click on a radio button | `tiktok-consent.tsx:246-258` an unticked box stamps `consentedAt`; changing any answer clears it (`:114`); refused without it by `tiktokPost.ts:169`, by `route.ts:179` and by the adapter before it reads `creator_info` or uploads a byte |
| 17 | Tell the user it can take a few minutes to appear on their profile (5d) | nothing | missing | `tiktokPost.ts:29`, shown at `tiktok-consent.tsx:260` and in the published result (`adapters/tiktok.ts:316`) |
| 18 | Status polled so the user can follow the post (5e) | `adapters/tiktok.ts:280-318`: 24 polls ten seconds apart, then resumes on the next run | done | unchanged |
| 19 | Schedule stays disabled until every answer is in | `clip-card.tsx:344,588` checked the answers without `creator_info`, so it was enabled while the lookup was loading or had failed | partial | `tiktokPost.ts:178` holds the button until `creator_info` has answered; `clip-card.tsx:346-347` |
| 20 | `creator_info` queried before every direct post | `adapters/tiktok.ts:326-337`, called at `:383` | done | `adapters/tiktok.ts:341-349`, called at `:403` |
| 21 | Inbox draft route under the sandbox key keeps working | `adapters/tiktok.ts:190-196` | done | untouched; `adapters/tiktok.test.ts` "leaves the inbox flow exactly as it was" asserts no `creator_info` call, no duration probe and no consent needed |

Rules that are enforced three times on purpose (panel, `/api/publish`, adapter),
because the browser may not be the only place TikTok's rules hold: audience must
be one TikTok offered, branded content cannot be private, an interaction the
creator has since switched off in TikTok is dropped rather than sent, the
disclosure must say who is promoted, and the creator must have agreed.

What the consent box means for scheduling: TikTok has no native scheduling, so
the clip is not sent when the creator clicks Schedule. It is sent when the
runner reaches the slot. The box says exactly that ("Nothing is sent to TikTok
before then"), and `consentedAt` records when the creator ticked it.

None of it is needed for the inbox route, which has no privacy or interaction
settings of its own, and that is exactly why TikTok allows an unaudited app to
use it. So the panel offers both: **Send to my TikTok inbox** (unchanged, and
still the default for every clip that does not touch the panel) and **Post
straight to my profile**, which is the path review is about.

Still open, and not fixable in code:

- The panel's amber line says a wider-than-private audience goes to the inbox
  until the app is approved. The Schedule button does not enforce that: a post
  booked wider than "Only you" is refused by the adapter at its slot
  (`adapters/tiktok.ts:351-355`). The demo script books "Only you" for that
  reason.
- Under the sandbox key, TikTok refuses Direct Post unless the target account is
  itself private, whatever the panel does. Shot 12 of the demo script films that
  refusal rather than a post.

## What sandbox does not solve

Sandbox mode exists to test without review, and it does not lift this: it has
no access to the Content Posting API for public videos. Unaudited direct posts
are restricted to private viewing whatever environment they run in. There is
no route to a public automatic post that skips approval.

This matters after approval too, because `.env` holds the sandbox credentials
today. Approval is granted to the production app, so step 10 below swaps the
client key and secret; leaving the `sbaw…` key in place would keep Direct Post
refused no matter what the portal says.

## The fork

**Lane A — stay as you are.** Clips keep uploading to the TikTok inbox and you
finish each one with a tap. Nothing to build, nothing to submit, no risk. The
cost is the tap, and the backlog that throttles uploads when the inbox grows.

**Lane B — become a product and resubmit.** Everything below. The cost is real
work, and TikTok has to believe a creator who is not you can use this.

Do not submit Lane B until the checklist is honestly complete. A second
rejection on the same grounds is worse than not submitting — the reviewer sees
the history.

## The framing that makes Lane B honest

The original checklist assumed CoLateral Marketing would become a hosted service
other creators sign into. It cannot be that without a build nobody has agreed
to: there is no login, no user model, and every data path resolves from
`process.cwd()` — one folder, one operator. Worse, the same app serves the
private screens (`/finance`, `/holdings`, `/notes`), so the running instance
can never be the public demo.

There is a second framing, and it is both true and acceptable to TikTok:
**self-hosted software**. Each creator installs their own copy and connects
their own account to it. That is exactly what the app already is, and it is not
"personal or company internal use" — it is a tool distributed to creators, the
same category as any open-source publishing client.

Everything below assumes that framing. `site/` is written to it.

## What you can and cannot claim today

Checked against the code on 2026-10-13. **Do not submit a sentence from the
column that is not true yet.**

| Claim | True? | Why |
|---|---|---|
| "Creators connect their own TikTok account" | **yes**, per install | The OAuth flow is real and works. One connection per copy of the app. |
| "Creators connect their accounts" (plural, one install) | **yes** | Each account has its own `tiktok.refreshToken.<accountId>` entry, its own cached profile and its own mirrored avatar; the adapter refreshes with the token belonging to the account the clip is booked to. Connecting a second profile leaves the first alone. |
| "The creator picks privacy, interactions and disclosure before posting" | **yes** | The consent panel, and enforced again server-side. |
| "We query `creator_info` before every direct post" | **yes** | `withCurrentCreatorSettings()` in the adapter. |
| "Nothing is sent to TikTok until the creator ticks a consent box" | **yes** | The panel's consent box; refused without it by the panel, `/api/publish` and the adapter. Row 16 of the gap table. |
| "Clips post automatically at a scheduled time" | **yes** | The publish runner does this today for YouTube, Instagram, Facebook and Threads; TikTok is inbox-only until approval. |
| "Open source" | **yes** | `nic21vdw/capital-command` is public, and the product page links straight to it from "Read the source" and the footer, so a reviewer can check the claim in one click instead of taking it on trust. |
| "Hosted at the registered address" | **yes** | `site/` is served by GitHub Pages at `https://nic21vdw.github.io/capital-command/`, deployed by `.github/workflows/pages.yml` on every push that touches `site/`. |

## Lane B checklist — must be true before you submit

1. ~~**A real address serving the product page.**~~ Done — GitHub Pages serves
   `site/` at `https://nic21vdw.github.io/capital-command/`. This is the item
   that had actually failed hardest: while the repo was private the registered
   Terms and Privacy URLs were raw GitHub links that returned **404** to
   anyone not signed in as Nic, and so did the Vercel URL on the repo. A
   reviewer clicking either got nothing, which is a rejection on its own and
   has nothing to do with the framing.
2. ~~**Terms and Privacy rewritten.**~~ Done — `site/terms.html`,
   `site/privacy.html`, mirrored into `TERMS.md` and `PRIVACY.md` so the
   currently-registered raw GitHub URLs stop saying "personal
   content-operations dashboard" the moment they are fetched.
3. ~~**Decide the redirect URI.**~~ Done — nothing changes. Pages serves four
   static files, not the app, so no callback can arrive there and the honest
   answer is that `http://localhost:3000/api/auth/tiktok/callback` stays the
   only one. Under the self-hosted framing that is consistent rather than
   suspicious: the callback runs on the creator's own machine.
4. ~~**The Direct Post consent panel built.**~~ Done, and then audited against
   TikTok's own guideline wording on 2026-10-13: thirteen of twenty-one rows were
   short and are fixed. See the gap table above.
5. ~~**Decide the open-source claim.**~~ Done — the repository is public, so
   "Open source · self-hosted" is true, and the page links to the source. What
   made this safe to do: `.env` was never committed, `data/` tracks only
   `.gitkeep`, and `data/publisher-tokens.json` is gitignored, so no
   credential or queue data is in the history.
6. **A creator who is not you can install it and connect their own account.**
   Under the self-hosted framing this is achievable: it means the setup
   documented in `LOCAL_SETUP.md` works for somebody else, on their machine,
   with their own TikTok app credentials. Test it with one person before you
   claim it.
7. **The five risks under "Submission" settled.** Website URL not a landing
   page, an https redirect URI, the "wide audience" answer, sandbox framing, and
   the watch task. None is a code change.
8. **The demo video recorded** from [TIKTOK-DEMO-SCRIPT.md](TIKTOK-DEMO-SCRIPT.md),
   after items 6 and 7, not before.

## Publishing `site/`

Three static files and a stylesheet, no build step. Any static host serves it:

```
site/index.html      the product page — the Web/Desktop URL to register
site/terms.html      the Terms of Service URL to register
site/privacy.html    the Privacy Policy URL to register
site/style.css
```

Preview it exactly as a reviewer will see it:

```
cd site && python -m http.server 8765
```

Hosting is GitHub Pages, which became available the moment the repository went
public. `.github/workflows/pages.yml` uploads `site/` as the Pages artifact on
every push that touches it — Pages cannot serve an arbitrary folder from a
branch, only the repo root or `docs/`, which is why this goes through Actions
rather than the branch-and-folder setting.

Switching it on is once, in the browser: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. After that the address is
`https://nic21vdw.github.io/capital-command/` and it updates itself.

Links inside `site/` are relative, so the same four files work unchanged if
they later move to a bought domain at a root path. Cloudflare Pages remains
the fallback if a custom domain is ever wanted — the account behind
`S3_ENDPOINT` already exists.

## Submission

Everything to paste into the developer portal on resubmission. Character counts
were measured on 2026-10-13. **If any sentence is not true when you read it,
change the app or change the sentence. Do not submit it as written.**

### The form

| Portal field | Value |
|---|---|
| App name | `CoLateral Marketing`. The portal still says "Capital Command"; TikTok wants the name to match the app or website and not to mention a social media company. |
| Description (max 120) | the block below, 98 characters |
| Terms of Service URL | `https://nic21vdw.github.io/capital-command/terms.html` |
| Privacy Policy URL | `https://nic21vdw.github.io/capital-command/privacy.html` |
| Web/Desktop URL | `https://nic21vdw.github.io/capital-command/` |
| Products | Login Kit, and Content Posting API with **Direct Post** on |
| Login Kit redirect URI | `http://localhost:3000/api/auth/tiktok/callback`, unchanged. See risk 2 below. |
| Scopes | `user.info.basic`, `video.publish`, `video.upload`. All three are demonstrated in the video; drop none. |
| Explanation of products and scopes (max 1000) | the combined block below, 984 characters |
| Demo video | one recording per [TIKTOK-DEMO-SCRIPT.md](TIKTOK-DEMO-SCRIPT.md), at most 50 MB, domain in the address bar matching the Web/Desktop URL on shot 1 |
| Verify domains | leave alone; `FILE_UPLOAD` needs none |

### Description

```
Creators connect their TikTok account, then schedule long-video clips to post to it automatically.
```

### Use case per scope

**`user.info.basic`**

```
Login Kit. After the creator connects their account we read display name, username and avatar only, to show which account is connected and which profile each scheduled clip will go to.
```

**`video.publish`**

```
Direct Post. We query creator_info and show the creator's nickname and avatar, the privacy options TikTok returned (none preselected) and Comment, Duet and Stitch toggles that follow creator_info and start off. Content disclosure is off by default. The creator previews the video, reads the Music Usage Confirmation, ticks consent, and we post at their scheduled time.
```

**`video.upload`**

```
Creators who prefer to caption inside TikTok choose Send to my TikTok inbox. The clip is uploaded as a draft for them to finish and publish in the TikTok app.
```

### Explanation of products and scopes (one box)

The portal takes a single explanation for the whole app. This is the three
blocks above under one lead, 984 characters against the 1000 limit. Paste it as
written; the portal counts as you type, so trim the last line first if the
address changes.

```
CoLateral Marketing is self-hosted software for creators. Each creator runs their own copy, connects their own TikTok account and decides what is posted.

user.info.basic: Login Kit. After the creator connects their account we read display name, username and avatar only, to show which account is connected and which profile each scheduled clip will go to.

video.publish: Direct Post. We query creator_info and show the creator's nickname and avatar, the privacy options TikTok returned (none preselected) and Comment, Duet and Stitch toggles that follow creator_info and start off. Content disclosure is off by default. The creator previews the video, reads the Music Usage Confirmation, ticks consent, and we post at their scheduled time.

video.upload: Creators who prefer to caption inside TikTok choose Send to my TikTok inbox. The clip is uploaded as a draft for them to finish and publish in the TikTok app.

Product page, terms and privacy: nic21vdw.github.io/capital-command
```

### Risks to settle before pressing Submit

These come from TikTok's own review and guideline pages, read 2026-10-13. None
can be settled in code, and none was visible in the earlier checklist.

1. **"Your website URL cannot be a landing page or login page."** The Web/Desktop
   URL is a single product page. It lists the permissions, links Terms and
   Privacy in the top bar and the footer (both visible without opening a menu,
   which the rules require) and links the source, but a reviewer can still call
   it a landing page. If it is rejected for that, the fix is more pages (setup,
   the TikTok section as its own page), not different words.
2. **"URIs must be absolute and begin with `https`"** is the Login Kit rule for
   redirect URIs, and the registered one is `http://localhost:3000/...`. The
   portal may accept it for a sandbox app and refuse it for production; that was
   not testable without signing in. Check the Login Kit page in the portal
   before submitting. If it refuses, the callback needs an https address, which
   for a self-hosted app means a tunnel or a documented per-creator redirect.
3. **"Not limited to internal groups/private use", "intended for a wide
   audience".** Approval attaches to one client key. A creator who installs their
   own copy needs a TikTok developer app of their own, and `LOCAL_SETUP.md` has
   no TikTok section that says so. Checklist item 6 is still open: do not let the
   description say more than "each creator runs their own copy" until someone who
   is not Nic has connected an account.
4. **Sandbox.** TikTok requires an app that has never been approved to be
   demonstrated from the sandbox environment, which is what `.env` holds. The
   video therefore ends at TikTok's refusal on shot 12, and says so. Do not
   present it as a successful public post.
5. **The audit watch is parked.** `npm run tiktok:watch` was disabled under the
   "Missing channels" work because it logged `NOT_APPROVED` every four hours for a
   decision that had already been made. Re-enable it with `npm run
   tiktok:watch:register` from the production folder only after the portal shows
   *Under review*, so it has something to watch.

## Scope audit

All three requested scopes are used. None should be dropped, and each has to
appear in the demo video or the review is delayed.

| Scope | Used by | Where in the video |
|---|---|---|
| `user.info.basic` | `GET /v2/user/info/` in `tiktokAuth.ts` — display name, avatar and username for the connected-account chip | Shot 3 |
| `video.publish` | Direct Post init in `adapters/tiktok.ts`, and the `creator_info` query behind the consent panel | Shots 5 to 12 |
| `video.upload` | Inbox init in the same adapter — the pre-approval path, and the creator's "send as draft" option | Shot 13 |

## The demo video

[TIKTOK-DEMO-SCRIPT.md](TIKTOK-DEMO-SCRIPT.md) is the video: fourteen shots in one
take of about three minutes, what to click, what to say, and which of TikTok's
guideline points each shot answers. This section keeps only what decides a
rejection, so the two cannot drift apart.

One take, 1080p, cursor visible, under 50 MB (the portal takes up to five videos
of 50 MB each). No cuts that hide a step; a cut where a decision happens reads as
something hidden. Narrate with captions or voice; silence makes the reviewer
guess.

**The sandbox decides how it ends.** `npm run tiktok:audit` answers `SANDBOX`: the
client key is the sandbox app's, and TikTok refuses Direct Post from an unaudited
client unless the target account is itself private
(`unaudited_client_can_only_post_to_private_accounts`). So shot 12 ends one of two
ways. On a public account it films TikTok's refusal, verbatim, and says what it
is. On a private account the refusal's own name says the post should be accepted
as a private post; that was not tried here, so do not promise it. Either way,
do not stage a post that TikTok did not accept.

Expect the panel's amber line, "The TikTok app review has not been approved, so
TikTok only accepts a private post here", to be on screen through the consent
shots. Leave it visible. It is true, the reviewer already knows it, and hiding it
would be the dishonest choice. It is also why the script books "Only you".

**Shot 13 needs the inbox cleared first.** TikTok is holding the maximum number
of unfinished drafts, so a fresh inbox upload is refused with
`spam_risk_too_many_pending_share` and there is nothing to film. Open TikTok and
post or discard the waiting drafts before recording.

The domain in the address bar must match the website registered for the app, in
every shot. This is the most common cause of a repeat rejection. For a
self-hosted app that means shot 1 is on `nic21vdw.github.io/capital-command` and
the app shots are on `localhost`, which is honest and consistent with what you
submitted, provided the explanation says the creator runs their own copy. Do not
fake a domain over the app.

**Keep the private screens off camera.** The sidebar reaches `/finance`,
`/holdings`, `/goals` and `/notes`. None of it belongs in a video a stranger
reviews. Record with the window sized so only the Uploading Center is in frame,
or collapse the sidebar first.

Record it after the checklist is true, not before; the video is the claim.

## Clicking through the portal

1. [developers.tiktok.com/apps](https://developers.tiktok.com/apps) → **Capital
   Command** (app ID `7667654582432024593`). It opens on **Not approved**.
2. **Return to Draft**, top right. Nothing is editable until that is clicked.
3. **Basic information**: rename the app to `CoLateral Marketing`, replace the
   Description with the one under "Submission", point Terms of Service URL
   and Privacy Policy URL at `https://nic21vdw.github.io/capital-command/terms.html` and
   `https://nic21vdw.github.io/capital-command/privacy.html`, and set the Web/Desktop URL to
   `https://nic21vdw.github.io/capital-command/` instead of the README.
4. **Products → Login Kit → Redirect URI**: change nothing unless the portal
   refuses an `http` address (risk 2 under "Submission").
   `http://localhost:3000/api/auth/tiktok/callback` stays the only one, and
   that is the honest answer here — Pages serves four static files, so the app
   is not running at the registered address and never receives a callback
   there. Adding a second URI that resolves to a product page would be a URI
   TikTok can redirect to and nothing can answer. The explanation already says
   each creator runs their own copy, which is what makes a localhost callback
   consistent rather than suspicious.
5. **Products → Content Posting API**: Direct Post stays enabled. Leave
   *Verify domains* alone unless you switch to `TIKTOK_UPLOAD_MODE=url`;
   `FILE_UPLOAD` needs no verified domain.
6. **Scopes**: `user.info.basic`, `video.publish` and `video.upload` all stay
   checked, per the audit above.
7. **App review**: paste the explanation from "Submission", delete the old
   `tiktok-demo.mp4`, upload the new recording.
8. **Submit for review**, then confirm the History tab reads *Under review* —
   if it does not, the submission did not go through.
9. Once History reads *Under review*, re-enable the parked watch with `npm run
   tiktok:watch:register`, from the production folder only. It logs every four
   hours and puts `TIKTOK-APPROVED.txt` on the Desktop the moment Direct Post
   opens. It cannot see a rejection, so check the portal yourself after a week.
10. On approval: copy the **production** Client key and Client secret from the
    portal into `.env` — the ones there now start `sbaw`, which is the sandbox
    app and stays unaudited forever — reconnect TikTok so the refresh token is
    issued against those credentials, then set `TIKTOK_AUDITED=true` and
    restart. The adapter switches to Direct Post on its own.

Reviews have come back anywhere from a day to a fortnight. The last one took
under 24 hours — a no is fast.

