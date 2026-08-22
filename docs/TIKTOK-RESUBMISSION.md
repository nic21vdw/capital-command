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

**2. The app did not implement the UX TikTok requires for Direct Post.**
Review never reached this, and it would have failed independently of the
framing. It is built now — the Uploading Center's TikTok consent panel — and
the table below is what it does:

| Required | Where it lives |
|---|---|
| Creator's nickname shown, so it is clear which account is being posted to | the account switcher, and the panel's own "Posting to …" line |
| A privacy dropdown with **no default**, options taken from `creator_info` | the panel opens on "Who can see this post…" and lists only the audiences that account was offered |
| Comment / Duet / Stitch toggles, all **off** by default, greyed out where the creator disabled them | three toggles, off until turned on, disabled with the reason when TikTok says the account has them off |
| Commercial-content disclosure (Your brand / Branded content), off by default | the disclosure toggle and its two options, sent as `brand_organic_toggle` / `brand_content_toggle` |
| The matching compliance line (Music Usage Confirmation, plus Branded Content Policy when that is selected) | `complianceStatement()`, shown under the disclosure as it is switched |
| A preview of what is about to be posted, and explicit consent | the clip card's preview, and Schedule refuses to fire while an answer is missing |
| `creator_info` queried before every direct post | `withCurrentCreatorSettings()` in the adapter, immediately before init |

Every row above was re-checked against the running app on 2026-08-22, against
`components/uploading-center/tiktok-consent.tsx` rather than from memory, and
all seven hold. Schedule really is disabled until the answers are complete —
`clip-card.tsx:324` puts `consentBlocker` in the button's `disabled`, with the
reason as its tooltip.

One thing the table does not say: if `creator_info` comes back with an empty
audience list, the dropdown falls back to listing every privacy level rather
than none. It is not a way to post something TikTok did not offer —
`consentProblem()` re-checks the choice against `creator_info` in the panel, in
`/api/publish` and again in the adapter — but the list itself is the one place
a value appears that the account was not handed.

Two rules are enforced twice on purpose — in the panel, and again server-side
in `/api/publish` and the adapter: branded content cannot be private, and an
interaction the creator has since switched off in TikTok is dropped rather
than sent. The browser is not allowed to be the only place TikTok's rules
hold.

None of it is needed for the inbox route, which has no privacy or interaction
settings of its own — that is exactly why TikTok allows an unaudited app to
use it. So the panel offers both: **Send to my TikTok inbox** (unchanged, and
still the default for every clip that does not touch the panel) and **Post
straight to my profile**, which is the path review is about.

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

The original checklist assumed Capital Command would become a hosted service
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

Checked against the code on 2026-08-19. **Do not submit a sentence from the
column that is not true yet.**

| Claim | True? | Why |
|---|---|---|
| "Creators connect their own TikTok account" | **yes**, per install | The OAuth flow is real and works. One connection per copy of the app. |
| "Creators connect their accounts" (plural, one install) | **yes** | Each account has its own `tiktok.refreshToken.<accountId>` entry, its own cached profile and its own mirrored avatar; the adapter refreshes with the token belonging to the account the clip is booked to. Connecting a second profile leaves the first alone. |
| "The creator picks privacy, interactions and disclosure before posting" | **yes** | The consent panel, and enforced again server-side. |
| "We query `creator_info` before every direct post" | **yes** | `withCurrentCreatorSettings()` in the adapter. |
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
4. ~~**The Direct Post consent panel built.**~~ Done — see the table above.
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

## The copy

Paste these once the checklist is true. **If any sentence is not true when you
read it, change the app or change the sentence — do not submit it as-is.**

### Description (max 120 characters)

> Creators connect their TikTok account, then schedule long-video clips to post
> to it automatically.

*(98 characters.)*

### App review notes (max 1000 characters)

> Capital Command is self-hosted software for creators. It cuts long-form
> video into clips and posts them to the TikTok account the creator
> connects, on a schedule they set. Each creator runs their own copy, so
> video, schedule and tokens stay on their machine.
>
> Login Kit + user.info.basic: the creator connects their account with
> OAuth. We read display name, avatar and username only, to label the
> connected account and each post.
>
> Content Posting API + video.publish: the creator picks privacy,
> interactions and commercial-content disclosure on our export screen,
> options queried from creator_info with nothing preselected, and we direct
> post at the scheduled time.
>
> Content Posting API + video.upload: creators who prefer to caption in
> TikTok choose send to inbox, and the clip arrives as a draft.
>
> New in this version: product page, terms and privacy are hosted at
> nic21vdw.github.io/capital-command and describe software creators run
> themselves; source at github.com/nic21vdw/capital-command.

*(995 characters, measured against TikTok's 1000 limit — paste it as five
paragraphs. The portal counts as you type; trim the last paragraph first if
you change the address.)*

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

### Two shots cannot be recorded as this list first described them

Checked against the live app on 2026-08-22, before recording rather than after.

**A direct post cannot be made to succeed today, at all.** `npm run
tiktok:audit` answers: the client key is the sandbox app's, a sandbox app is
unaudited by definition, and *that refusal will never lift however the
production review goes*. Forcing SELF_ONLY does not get around it either —
TikTok refuses Direct Post from an unaudited client unless the target account
is itself private (`unaudited_client_can_only_post_to_private_accounts`). So
there is no way to film a clip going straight to the profile and appearing
there. Shot 7 below is rewritten to film what does exist: the call being made
and TikTok's own answer. The consent UX, which is what TikTok's guidelines
actually require of the app, films completely.

Expect the panel's own amber line — "The TikTok app review has not been
approved, so TikTok only accepts a private post here" — to be on screen during
shots 5 to 7. Leave it visible. It is true, the reviewer already knows it, and
hiding it would be the dishonest choice.

**Shot 8 needs the inbox cleared first.** TikTok is holding the maximum number
of unfinished drafts, so a fresh inbox upload is refused with
`spam_risk_too_many_pending_share` and there is nothing to film. Open TikTok
and post or discard the waiting drafts before recording, or shot 8 fails on
camera.

The domain in the address bar must match the website registered for the app,
in every shot. This is the most common cause of a repeat rejection. For a
self-hosted app that means shot 1 is on `nic21vdw.github.io/capital-command` and the app shots are on
`localhost` — which is honest and consistent with what you submitted, provided
the review notes say the creator runs their own copy. Do not fake a domain over
the app.

**Keep the private screens off camera.** The sidebar reaches `/finance`,
`/holdings`, `/goals` and `/notes`. None of it belongs in a video a stranger
reviews. Record with the window sized so only the Uploading Center is in frame,
or collapse the sidebar first.

| # | Shot | What must be on screen |
|---|---|---|
| 1 | Product page at `https://nic21vdw.github.io/capital-command/` | `site/index.html` live on the registered domain, address bar visible. Hold on the "What the TikTok connection does" section — it states the three scopes in the same words as the review notes, which is the fastest way for a reviewer to match them. |
| 2 | Open the Uploading Center | The creator's own installation. Sidebar collapsed; no finance, holdings, goals or notes on screen. |
| 3 | **Connect TikTok** | Click it; the TikTok OAuth consent screen appears with the scopes listed; authorize; land back in the app with the account chip showing avatar, display name and @handle. That is `user.info.basic`, on camera. |
| 4 | Pick a clip | The clip card with its video preview and caption — the "preview of the to-be-posted content" the guidelines require. |
| 5 | Open the export panel | Choose **Post straight to my profile**. Privacy dropdown **unselected**, interaction toggles **all off**, commercial-content toggle **off**. Hold two seconds so the defaults are legible. |
| 6 | Fill it in | Choose a privacy level, turn on one interaction toggle, show a toggle greyed out because the creator's TikTok settings disable it, then turn on the commercial-content disclosure and let the compliance line appear. |
| 7 | Post, and show the wall | With every answer filled in, Schedule stops being greyed out — hold on that, because a button that only enables once the creator has answered *is* the consent requirement, on camera. Click it and let TikTok's refusal appear verbatim. Say what it is: Direct Post is built and gated on this review, and cannot succeed from an unaudited client. Do not stage a post that TikTok did not accept. |
| 8 | The draft path | Back in the app, choose "send to inbox" on another clip, then show the TikTok inbox notification and the draft waiting there. That is `video.upload`, and it is the one posting path that films end to end today — **clear the inbox before recording** or it is refused. |
| 9 | The schedule | The calendar with clips booked into future slots, to show what "automatically" means. |

Record it after the checklist is true, not before — the video is the claim.

[TIKTOK-DEMO-SCRIPT.md](TIKTOK-DEMO-SCRIPT.md) is this table as one take:
what to say over each shot, timed to about 110 seconds, with the checks to
run before pressing record.

## Clicking through the portal

1. [developers.tiktok.com/apps](https://developers.tiktok.com/apps) → **Capital
   Command** (app ID `7667654582432024593`). It opens on **Not approved**.
2. **Return to Draft**, top right. Nothing is editable until that is clicked.
3. **Basic information**: replace the Description, point Terms of Service URL
   and Privacy Policy URL at `https://nic21vdw.github.io/capital-command/terms.html` and
   `https://nic21vdw.github.io/capital-command/privacy.html`, and set the Web/Desktop URL to
   `https://nic21vdw.github.io/capital-command/` instead of the README.
4. **Products → Login Kit → Redirect URI**: change nothing.
   `http://localhost:3000/api/auth/tiktok/callback` stays the only one, and
   that is the honest answer here — Pages serves four static files, so the app
   is not running at the registered address and never receives a callback
   there. Adding a second URI that resolves to a product page would be a URI
   TikTok can redirect to and nothing can answer. The review notes already say
   each creator runs their own copy, which is what makes a localhost callback
   consistent rather than suspicious.
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
10. On approval: copy the **production** Client key and Client secret from the
    portal into `.env` — the ones there now start `sbaw`, which is the sandbox
    app and stays unaudited forever — reconnect TikTok so the refresh token is
    issued against those credentials, then set `TIKTOK_AUDITED=true` and
    restart. The adapter switches to Direct Post on its own.

Reviews have come back anywhere from a day to a fortnight. The last one took
under 24 hours — a no is fast.
