# TikTok: what works, and what the app review actually said

## Short version

TikTok posting works today. Automatic TikTok posting does not, and will not
until TikTok approves the app — which it has already declined once.

| | State |
|---|---|
| OAuth (Login Kit, refresh, rotation) | working — the connection is live |
| Upload of a clip to TikTok | working — clip goes to your TikTok **inbox** |
| Direct Post (straight to the profile, no tap) | blocked by app review |
| App review | **Rejected 2026-07-29**, not pending |

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

Someone has to resubmit the review from the portal, and the resubmission has
to answer the rejection rather than repeat the submission:

1. `Return to Draft` on the app.
2. Rewrite the description and the review notes so they describe the product,
   not one person's own accounts — TikTok rejects "for my own channels"
   outright. Only claim what is true.
3. Record a fresh demo video showing the real end-to-end flow on the domain
   registered for the app, covering every product and scope requested
   (`user.info.basic`, `video.publish`, `video.upload`). Drop scopes that are
   not demonstrated; unused scopes delay the review.
4. Submit, then let `npm run tiktok:watch` catch the moment Direct Post opens.
5. When it does: set `TIKTOK_AUDITED=true` in `.env` in production and
   restart. No code change — the adapter switches to Direct Post and honours
   each item's visibility.

Until step 5, everything else in the pipeline already works; the tap is the
whole difference.
