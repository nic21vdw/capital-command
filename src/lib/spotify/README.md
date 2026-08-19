# Spotify (Web API)

The connected Spotify account, and the answer to the only question the podcast
feed cannot answer for itself: **has Spotify actually pulled that episode in
yet?**

## What this can and cannot do

Read `src/lib/podcast/README.md` first. Spotify has no write API for creators —
no upload, no episode create, no show edit. The Distribution API is open to a
handful of licensed hosts only. So the app publishes an RSS feed and Spotify
pulls from it, and **nothing in this folder can publish anything**.

What the Web API does give is the show as Spotify lists it. That closes the
loop the feed leaves open: `publishEpisode` knows the MP3 was uploaded and the
feed rewritten, but only Spotify knows whether it has fetched it, and that can
take hours. `spotifyStatus()` asks.

Do not add a headless-browser upload into Spotify for Creators here. It breaks
on every UI change and Spotify's terms do not invite it.

## The grant

`auth.ts` is the same shape as `tiktokAuth.ts`: the browser only sees Spotify's
consent screen and a redirect back to `/podcast`, while the client secret and
the refresh token stay server-side in `tokens.ts`
(`data/publisher-tokens.json`). Scopes are `user-read-email user-read-private
user-library-read` — all reads, none of which can post.

Two things about the redirect URI, both of which will waste an afternoon if
forgotten:

- Spotify stopped accepting `localhost` in 2025. A loopback redirect must be
  the literal `127.0.0.1`, so `spotifyRedirectUri` rewrites the origin the app
  was opened on rather than trusting it. Both `http://127.0.0.1:3000/...` and
  the sandbox's `:3100` are registered on the app; `SPOTIFY_REDIRECT_URI`
  overrides if a third is ever needed.
- The refresh token's lifetime is **180 days** on this app, and it is not
  renewed by use. When it lapses, the Podcast page says disconnected and the
  fix is to click Connect Spotify again.

That is also why every read falls back to a client-credentials app token
(`spotifyAppToken`) when there is no user token: the show and episode lookups
need no account, so the "is it live" check keeps working through a lapsed
grant.

## Matching an episode to its Spotify twin

`match.ts` is the whole trick and it is pure and tested. The feed's guid never
reaches Spotify — Spotify mints its own episode ids — so the only durable link
is the title, compared with casing, punctuation and emoji removed. A prefix
match covers a title one side truncated, floored at 8 characters so "Day 1"
cannot claim "Day 12", and the longest overlap wins so two similar titles
cannot swap.

If a real episode ever shows as pending while it is plainly on Spotify, the
title drifted between the feed and the show page. That is the place to look.

## Shape

- `auth.ts` — consent URL, code exchange, refresh, disconnect, cached profile.
- `api.ts` — show lookup, show search, episode listing, `parseShowId` (id,
  `spotify:show:` URI or an `open.spotify.com` link all work).
- `match.ts` — pure title matching.
- `status.ts` — what `/api/spotify` returns and what the Podcast page renders.

The linked show's id lives on the podcast show record
(`data/podcast/show.json` → `show.spotifyShowId`) rather than in a settings
file of its own, because it belongs to the same show every other podcast
setting describes.
