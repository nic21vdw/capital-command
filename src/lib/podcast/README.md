# Podcast feed (Spotify)

Every long-form video the pipeline finishes also goes out as a podcast episode.
Shorts do not — they are not episodes.

## Why there is no Spotify API call in here

Spotify has **no write API for creators**. The Web API is read-only for shows
and episodes; the Distribution API is only open to a handful of licensed hosts
(Acast, Libsyn, Omny and friends), not to individual creators. The only
supported way to get an episode onto Spotify without a person clicking Upload
is the one every podcast host uses: publish an RSS feed and let Spotify pull
from it.

So this module IS the podcast host. It writes `feed.xml` to the same media host
the publisher already uses (Cloudflare R2), and Spotify re-reads that URL on its
own schedule — usually within a few hours of a new episode.

Do not replace this with a headless-browser upload into Spotify for Creators.
Those break on every UI change, and Spotify's terms do not invite them. The
feed is the sanctioned route and it is strictly less work.

## The one manual step

Submitting the feed once, at
`Spotify for Creators → Add your podcast → I have an existing podcast`, and
clicking the link in the verification email Spotify sends to `show.email`. That
is why the email address is a hard requirement in `feedProblems` — a feed
without a reachable owner address cannot be claimed, and the failure only shows
up after submission.

After that, nothing about a new episode is manual.

## Shape

- `feed.ts` is pure and is where every rule Spotify judges the feed on lives —
  the tags, the ordering, the escaping, and `feedProblems`, which is the list of
  things Spotify would reject. All of it is tested without a network.
- `store.ts` owns `data/podcast/show.json` (the show details plus every episode
  record). `addEpisode` is idempotent by export id.
- `artwork.ts` reads the width and height straight out of the PNG/JPEG header —
  no image library — so a cover that Spotify would reject is caught before it is
  uploaded rather than by an email days after the show was submitted. The page
  takes the image itself and hosts it; asking a person to go find a public URL
  for a JPEG was work the app could do.
- `publish.ts` uploads the MP3 and rewrites the feed. It needs
  `S3_PUBLIC_BASE_URL` as well as the other `S3_*` variables: an RSS feed cannot
  point at a presigned URL, because those expire and Spotify reads the feed for
  the life of the show.
- `publicUrl.ts` is how that address gets set without a text editor. The Podcast
  page writes it through `POST /api/podcast` (`set-public-url`), which is the
  only setting the app changes in `.env` for itself. It lives there rather than
  in a podcast settings file because every other process that builds a URL out
  of the bucket — the publish runner, the CLIs, a GitHub Actions run — reads it
  from `publisherConfig()` too, and a second store would mean two answers.
  `checkPublicBaseUrl` and `applyEnvValue` are pure and tested: the first
  refuses anything Spotify could not fetch (http, credentials, a query string,
  localhost or a private address), the second rewrites exactly one assignment
  and leaves every other line, comment, BOM and line ending in that
  secret-carrying file untouched. `writePublicBaseUrl` also sets the value in
  `process.env`, because `next start` reads `.env` once at boot — that is what
  makes the change take effect with nothing to restart, and why `mediaHost()`
  caches on the settings that shape a URL rather than forever.
- The pipeline's `podcast` stage books the finished MP3 through `scheduleEpisode`.
  The default is one episode per day at 10:00 America/Toronto. The Podcast page
  controls the time, zone and enabled switch, plus individual releases.
- `schedule.ts` persists bookings in `show.json` alongside the feed state.
  The existing 90-second server heartbeat drains at most one due episode per
  tick, including when no pipeline is active and the page is closed. The app
  must be running. Overdue episodes resume after restart.
- Missing host or show settings remain visible setup blockers without spending
  upload retries. After setup is fixed, due releases resume automatically.
  Upload/feed failures back off from five minutes and stop after five attempts;
  Retry delivery resets that bound. A 30-minute publishing lease recovers a
  process restart. Global Automations pause and the enabled switch stop drains.
- Export IDs deduplicate bookings, publication is serialized, and export-based
  object keys survive interrupted uploads. A saved episode whose feed write
  failed is republished into the feed on retry without uploading another MP3.
- Daily booking reserves a local calendar date, including repeated autumn
  hours. A nonexistent spring clock time skips to the next valid day.
- `/api/podcast/rss` serves the same feed locally for validation. It is NOT the
  URL to give Spotify — this app is not on the public internet.
