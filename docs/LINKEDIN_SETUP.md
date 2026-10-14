# Connecting LinkedIn

LinkedIn publishing ships switched off. Nothing posts, and the LinkedIn tab stays out of
the Uploading Center, until you create a LinkedIn app, paste its two credentials and sign
in once. Budget 20 minutes for posting as yourself. Posting as a company page needs one
more approval from LinkedIn (step 3).

The app posts a picture, a video, or a carousel. A carousel is the deck's slides rendered
into one PDF and posted as a LinkedIn document, which is how LinkedIn carousels work.
Everything LinkedIn gets is public: a private or unlisted post is never sent to LinkedIn
(see "Who it posts as, and what it will post").

## 1. Create the LinkedIn app

1. Go to <https://www.linkedin.com/developers/apps> and press **Create app**.
2. App name: `CoLateral Marketing` (anything you like).
3. LinkedIn Page: pick a company page you administer. LinkedIn requires every app to be
   associated with one, even if you only post as yourself. Create a page for the project
   if you do not have one.
4. Privacy policy URL: any URL you control. App logo: any square image.
5. Tick the legal agreement and press **Create app**.
6. On the app's **Settings** tab press **Verify** next to the company page. LinkedIn gives
   you a link; open it while signed in as an administrator of that page and approve it.
   The app cannot add products until this is verified.

## 2. Add the products

Open the app's **Products** tab and press **Request access** on each:

| Product | What it gives the app | Approval |
|---|---|---|
| **Share on LinkedIn** | `w_member_social`: post as you | Instant |
| **Sign In with LinkedIn using OpenID Connect** | `openid`, `profile`: tells the app which member signed in | Instant |
| **Community Management API** | `w_organization_social`: post as a company page. `r_organization_admin`: list the pages you administer | LinkedIn reviews it |

Share on LinkedIn and Sign In with LinkedIn using OpenID Connect are all you need to post as
yourself. Ask for the Community Management API only if you want to post as a company page.

After the products show as added, the **Auth** tab lists the scopes your app may request.
You should see `openid`, `profile` and `w_member_social`.

Why `r_organization_admin`: it is the permission LinkedIn ties to the "which pages does this
member administer" lookup the app uses to fill the page list, and `w_organization_social` only
lets the app post as a page, not find one. If you skip `r_organization_admin`, posting as a page
still works once you type the page's ID in.

If the Products tab will not let you add the Community Management API next to the other two,
leave it for later: posting as yourself does not need it, and it can be added when LinkedIn
approves it.

## 3. Register the redirect URL

On the **Auth** tab, under **OAuth 2.0 settings**, press the pencil next to **Authorized
redirect URLs for your app** and add:

```
http://localhost:3000/api/linkedin/callback
http://127.0.0.1:3000/api/linkedin/callback
```

LinkedIn compares the address character for character. Settings > Accounts > LinkedIn shows
the exact address the app sends once the credentials below are saved; if that differs
from these two (a different port, say), register that one instead. To force a particular
address, set `LINKEDIN_REDIRECT_URI` in `.env` and register the same value.

## 4. Give the app the credentials

On the same **Auth** tab copy the **Client ID** and the **Primary Client Secret**. Then
either:

- open **Settings > Accounts > LinkedIn**, paste both and press **Save credentials**, or
- add them to `.env` and restart the server:

```
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
```

`.env` wins over Settings if both are set. Until both values exist the LinkedIn row says
what is missing and links back to this page.

## 5. Sign in

1. In **Settings > Accounts > LinkedIn** press **Connect LinkedIn** and approve the
   permissions on LinkedIn's screen.
2. You land back on Settings with LinkedIn marked Connected.
3. Under **Who LinkedIn posts as** choose your profile or a company page. The choice
   applies to every LinkedIn post until you change it.

Company pages: once LinkedIn has approved the Community Management API, press **Connect
with company pages**. The app lists the pages you administer. If a page does not appear,
type its numeric ID into **Add a page by its ID** (it is the number in the page's admin
address, `linkedin.com/company/<number>/admin`).

## Who it posts as, and what it will post

LinkedIn posts are always public, from you or from a page. A post whose visibility is
private or unlisted is never sent to LinkedIn: booking it saves a reminder on the
LinkedIn leg that says why, and the other platforms on the same post go out as normal.
Post it by hand, or schedule it again as a public post.

## 6. Book a post

The LinkedIn tab appears in the **Uploading Center** as soon as LinkedIn is connected. Book
a clip there like any other platform, or pick **LinkedIn** in a carousel's schedule dialog.

A carousel that is already booked to Instagram and Facebook can have LinkedIn added: open
its schedule dialog and pick LinkedIn. It becomes a second post of the same deck, on
LinkedIn's own time, and the deck then shows as booked on all three. Booking LinkedIn
twice, or Instagram twice, is still refused.

LinkedIn is deliberately not part of **All platforms**, and it is not in the default
platform list or the YouTube mirror, so connecting it does not start posting every clip to
LinkedIn. To make automatic bookings include it, add it explicitly in `.env`:

```
PUBLISH_PLATFORMS=youtube,instagram,tiktok,facebook,linkedin
PUBLISH_MIRROR_TARGETS=instagram,facebook,linkedin
```

Captions for LinkedIn are written in a professional, longer voice with at most three
hashtags, and bare `colateralai.com` links become `colateralai.com/li` so visits from
LinkedIn can be told apart. That path must exist on the website for the link to land.

What LinkedIn accepts:

| Post | Limits |
|---|---|
| Caption | 3,000 characters |
| Picture | JPG, PNG or GIF |
| Video | MP4, up to 5 GB; LinkedIn's own length limits apply |
| Carousel | up to 10 slides, rendered to one PDF document (LinkedIn allows 100 MB and 300 pages) |

The app uploads the file to LinkedIn directly, so LinkedIn does not need the Media hosting
setup that Instagram and Facebook need. Each upload request has a deadline of two minutes plus
thirty seconds for every 10 MB, so a stalled connection is retried instead of holding the post.

A text post with a link exists in the code (`publishLinkedinText` in
`src/lib/publisher/adapters/linkedin.ts`) and is tested, but nothing in the app books one
yet: every post in the queue is a picture, a video or a carousel.

## When the sign-in runs out

LinkedIn signs an app in for about 60 days. Ordinary apps are not given a refresh token, so
the app cannot renew the sign-in by itself. Seven days before it ends, a banner appears on
every screen with a **Reconnect** button; press **Connect LinkedIn** again to start a
fresh 60 days. Nothing is lost by reconnecting: the chosen author and queued posts stay.

If LinkedIn does issue a refresh token for your app, the app uses it quietly and the banner
only appears if the refresh token itself is about to lapse.

If a token is rejected while a post is going out, that LinkedIn account is held like any
other platform: the banner names it, queued posts wait with their retries intact, and it is
tried again every half hour until you reconnect.

## When a post may already be live

If LinkedIn does not answer the request that creates a post (a timeout, a 408, a 5xx),
the post may exist even though the app never saw the answer. The app does not try again on
its own: it marks the LinkedIn leg failed with "May already be posted. Check the LinkedIn
feed, then re-arm to post again". Look at your LinkedIn feed; if the post is not there, press
Retry on the leg to re-arm it. Re-arming keeps the picture or video it already uploaded, so
only the post itself is sent again. The same message appears if the app stopped between
sending the request and recording the answer.

If you re-arm that leg and LinkedIn then refuses the post as a duplicate of a post it names, the
app records the leg as published with that post's ID: the first request did go through. A
post that was never in doubt gets no such benefit. If LinkedIn refuses a fresh post as a
duplicate, the leg fails with "LinkedIn refused: same text as an earlier post"; change the
caption and schedule it again.

If the request never left the machine (no internet, a DNS failure, a refused connection or a
certificate error), nothing can have been posted, so the app tries again with the usual
backoff. Only a timeout, a 408 or a 5xx after the request was sent counts as "may already be
posted".

## Limits

- LinkedIn counts calls per day and resets at midnight UTC. When it answers HTTP 429 the
  post waits until just after the reset without using up its retries.
- The app also stops after 10 LinkedIn posts in a UTC day and sends the rest on the next
  run after midnight UTC. Change it with `LINKEDIN_DAILY_POST_BUDGET`.
- A server error (5xx) retries with the usual backoff. A rejected token (401) trips the
  platform health banner. Other 4xx answers fail the post with LinkedIn's reason, for
  example `422` when the text is identical to a recent post.

## Optional settings

| `.env` | Default | What it does |
|---|---|---|
| `LINKEDIN_REDIRECT_URI` | `<origin>/api/linkedin/callback` | Force the redirect address sent to LinkedIn |
| `LINKEDIN_API_VERSION` | built in (`YYYYMM`) | The `LinkedIn-Version` header. Set it if LinkedIn answers that the version is not active |
| `LINKEDIN_DAILY_POST_BUDGET` | `10` | Most posts per UTC day |
| `LINKEDIN_PKCE` | off | Adds a PKCE challenge to the sign-in. LinkedIn honours PKCE for native apps, so leave it off unless LinkedIn tells you otherwise |

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| `redirect_uri` mismatch on LinkedIn's page | The address is not registered exactly | Copy the address from Settings > Accounts > LinkedIn into the app's Authorized redirect URLs |
| `unauthorized_scope_error` | A product is not added or not approved | Check the Products tab, then reconnect |
| `invalid_client` | Wrong Client ID or secret | Re-copy both from the Auth tab and save them again |
| Post as a page fails with a permission message | The sign-in has no `w_organization_social` | Get the Community Management API approved, then **Connect with company pages** |
| `HTTP 403` on a page post | The signed-in member is not an administrator of that page | Make them a Super admin or Content admin of the page |
| `Requested version ... not active` | LinkedIn retired the built-in API version | Set `LINKEDIN_API_VERSION` to a current `YYYYMM` from LinkedIn's versioning page |
| `HTTP 422` duplicate content | LinkedIn refuses repeated identical text | Change the caption |
