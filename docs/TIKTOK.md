# TikTok: what works, and what the app review actually said

## Short version

TikTok posting works today. Automatic TikTok posting does not, and will not
until TikTok approves the app — which it has already declined once.

| | State |
|---|---|
| OAuth (Login Kit, refresh, rotation) | working — the connection is live |
| Upload of a clip to TikTok | working — clip goes to your TikTok **inbox** |
| The consent panel Direct Post requires | built — audience, interactions and disclosure, per post |
| Direct Post (straight to the profile, no tap) | blocked by app review; only "Only you" is accepted until then |
| App review | **Rejected 2026-07-29**, not pending — and not resubmitted since |
| The credentials in `.env` | the **sandbox** app's, so approval would not reach this machine on its own |

## The review

App `Capital Command` (`7667654582432024593`), submitted 2026-07-28,
rejected by TikTok Admin on 2026-07-29. The reviewer's note:

> App will not be approved for personal or company internal use. TikTok for
> Developers currently does not support personal or internal company use.

The submitted description — clips a long-form stream and schedules it to *my
own* TikTok, YouTube and Instagram accounts — is exactly the case that note
excludes. Nothing in the code caused this and no amount of waiting clears it:
the app sits in **Not approved / Return to Draft** in the portal, and TikTok
is not reviewing anything right now.

## The credentials are the sandbox app's

`TIKTOK_CLIENT_KEY` in `.env` is `sbawr0…` — the `sbaw` prefix is the sandbox
app, not the production one. That is the right way to develop against a
never-approved app, and TikTok's own review page requires it. It also means
the audit probe has been asking a question with only one possible answer: a
sandbox app is unaudited by definition, so Direct Post is refused there whether
production is approved, rejected or still being read.

So approval alone would change nothing here. It lands on the **production**
app, and only reaches this machine when the production `TIKTOK_CLIENT_KEY` and
`TIKTOK_CLIENT_SECRET` are in `.env` — with a fresh OAuth connection, because
the cached refresh token belongs to the sandbox app and will not refresh
against production credentials. `TIKTOK_AUDITED=true` on its own does nothing.

`npm run tiktok:audit` now says `SANDBOX` rather than `NOT_APPROVED` when it
sees a sandbox key, so the log stops reading like a queue someone is waiting
in.

`npm run tiktok:watch` could not see any of that. TikTok refuses Direct Post
with `unaudited_client_can_only_post_to_private_accounts` whether a review is
queued, rejected, or was never submitted, so the watcher logged
`NOT_APPROVED — still waiting` about 73 times over three weeks for a decision
that had already been made on day two. It now says so; the portal remains the
only place a decision appears.

## What happens to a scheduled TikTok clip today

`TIKTOK_AUDITED=false`, so the adapter uses the inbox flow: the clip is
uploaded to TikTok, lands in the creator's inbox, and the last step is a tap
in the TikTok mobile app. The queue records that as `scheduled` with
"Sent to your TikTok inbox".

TikTok will only hold so many untapped uploads. Past that it refuses new ones
with `spam_risk_too_many_pending_share` — which is what stopped three clips on
2026-08-12 and 08-13. That refusal arrives as HTTP 400, which used to be read
as a permanent failure, so the clips were discarded rather than retried. They
are now **deferred** instead: the item keeps its attempts, waits six hours and
tries again, and the run reports what to do — open TikTok and clear the inbox.

The practical limit is therefore the phone, not the code. Clips upload as fast
as they are scheduled; each still needs a tap.

## Getting Direct Post

[TIKTOK-RESUBMISSION.md](TIKTOK-RESUBMISSION.md) is the worked version of this
— the two reasons a resubmission fails today, the copy to paste, the demo
video shot list and the portal click-through. The short form:

1. `Return to Draft` on the app.
2. Rewrite the description and the review notes so they describe the product,
   not one person's own accounts — TikTok rejects "for my own channels"
   outright. Only claim what is true.
3. Record a fresh demo video showing the real end-to-end flow on the domain
   registered for the app, covering every product and scope requested
   (`user.info.basic`, `video.publish`, `video.upload`). Drop scopes that are
   not demonstrated; unused scopes delay the review.
4. Submit, then let `npm run tiktok:watch` catch the moment Direct Post opens.
5. When it does: put the **production** `TIKTOK_CLIENT_KEY` and
   `TIKTOK_CLIENT_SECRET` in `.env`, reconnect TikTok so the refresh token is
   issued against them, set `TIKTOK_AUDITED=true`, and restart. No code change
   — the adapter switches to Direct Post and honours each item's visibility.

Until step 5, everything else in the pipeline already works; the tap is the
whole difference.
