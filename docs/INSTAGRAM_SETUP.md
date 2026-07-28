# Getting the Instagram API credentials

The publisher needs exactly two values to post Reels: `IG_USER_ID` and
`IG_ACCESS_TOKEN`. Everything below is about getting them out of Meta, and
almost all of it is one command — the only manual part is the Meta dashboard,
which has no API for creating an app.

Budget 15 minutes. You do **not** need App Review to post to your own account.

---

## Before you start

Three things have to be true, or none of the API calls will work:

1. The Instagram account is a **professional** account (Business or Creator).
   Instagram app → Settings → Account type and tools → Switch to professional.
2. It is **linked to a Facebook Page**. Instagram app → Settings → Accounts
   Center, or Meta Business Suite → Settings → Accounts. Any Page works; make a
   throwaway one if you don't have a real one.
3. You are logged into Facebook as someone who **administers that Page**.

If step 2 is missing, the connect command will tell you so by name rather than
failing with a Graph error code.

---

### If the app uses Facebook Login for Business

Check **Facebook Login for Business → Configurations** on the app. If that list
is empty, the login dialog has nothing to launch through and fails with a bare
"Something went wrong" — create a configuration (General, *user access token*,
with the four permissions below) before generating any token.

## 1. Create the Meta app

1. Go to <https://developers.facebook.com/apps> and click **Create app**.
2. Use case: **Other** → app type **Business** → give it a name
   (e.g. "Capital Command Publisher") → create.
3. On the app's dashboard, add the **Instagram** product (and **Facebook
   Login for Business**, if it isn't added for you).
4. **App settings → Basic**: copy the **App ID** and click **Show** next to the
   **App secret** and copy that too. These are the `--app-id` and
   `--app-secret` below. Treat the secret like a password.

Leave the app in **Development** mode. In development mode the API still
publishes to accounts you administer, which is all you need. App Review is only
required to post on behalf of *other* people.

## 2. Generate a one-hour token

1. Go to **Tools → Graph API Explorer**
   (<https://developers.facebook.com/tools/explorer>).
2. Top right: pick your app in the **Meta App** dropdown.
3. **User or Page** → *User token*.
4. **Add permissions** — tick all four:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`

   Add `pages_manage_posts` too if you also want Facebook Reels publishing.
5. Click **Generate Access Token**, complete the Facebook login popup, and make
   sure you tick the Page your Instagram account is linked to when it asks
   which Pages the app may access.
6. Copy the token out of the box. It expires in about an hour — that is
   expected, the next step trades it for a permanent one.

## 3. Run the connect command

From the repo root:

```bash
npm run publish:instagram:connect -- \
  --app-id <app id from step 1> \
  --app-secret <app secret from step 1> \
  --token <token from step 2> \
  --write
```

It will:

- exchange the one-hour token for a long-lived (60-day) user token;
- read back which permissions were actually granted, and name any that are
  missing rather than letting you discover it at publish time;
- list your Pages and find the Instagram professional account linked to one
  (if several Pages qualify it stops and asks for `--page <id|name>`);
- if no Page reports one — which is what happens when the account is connected
  through a **business portfolio** rather than the older Page link — it tells
  you to pass `--ig-user-id <id>`, which you can read off
  business.facebook.com → Settings → Accounts → Instagram accounts. It then
  finds whichever token can actually reach that account, preferring a Page
  token (never expires) and falling back to the user token (60 days);
- take that Page's access token — a Page token derived from a long-lived user
  token **does not expire**, which is why this is the token that gets saved;
- call the publishing-quota endpoint as a live proof the credentials work;
- write `IG_USER_ID`, `IG_ACCESS_TOKEN`, `IG_APP_ID`, `IG_APP_SECRET`,
  `FB_PAGE_ID` and `FB_PAGE_ACCESS_TOKEN` into `.env`, leaving every other line
  in that file alone.

Drop `--write` to print the values instead of saving them.

## 4. Confirm it

```bash
npm run publish:instagram:check
```

Prints the account it is pointed at, the follower count, how many of the ~50
API posts per rolling 24 hours you have used, and whether the token expires.
A healthy connection says **never expires**.

## 5. Turn publishing on

In `.env`:

```
PUBLISH_ENABLED=true
PUBLISH_PLATFORMS=youtube,instagram,tiktok
```

Instagram also needs the clip on a public HTTPS URL, because Meta downloads the
video itself rather than accepting an upload. Set the `S3_*` variables — the
Cloudflare R2 free tier covers this at $0. See the README's "Media hosting"
section.

Then dry-run before anything goes out:

```bash
npm run publish:dry
```

---

## Things that will bite you

- **Reels published through the API are always public.** There is no private or
  draft option. Point `IG_USER_ID` at a test account for trial runs; the adapter
  refuses to publish an item whose visibility isn't `public`, on purpose.
- **~50 API posts per rolling 24 hours.** The adapter checks this before
  creating a container and backs off rather than burning the attempt.
- **The token dies if you change your Facebook password**, remove the app, or
  lose Page admin rights. Re-run step 2 and 3 — that is the whole recovery.
- **Personal Instagram accounts cannot publish via the API at all.** If
  `publish:instagram:check` reports the wrong account, the professional account
  is probably linked to a different Page.
- **Video requirements**: MP4/MOV, 9:16, up to 15 minutes. A container that
  Meta cannot process comes back as status `ERROR`, which the adapter surfaces
  as a permanent failure with that hint.

## Where this lives in the code

| Piece | File |
| --- | --- |
| Connect / inspect flow | `src/lib/publisher/instagramConnect.ts` |
| CLI commands | `src/lib/publisher/cli.ts` (`instagram connect`, `instagram check`) |
| Publishing adapter | `src/lib/publisher/adapters/instagram.ts` |
| Config reader | `src/lib/publisher/config.ts` |
