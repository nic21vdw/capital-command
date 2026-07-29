# Privacy Policy

**Last updated: July 28, 2026**

Capital Command is a personal content-operations dashboard, built and run by
Nic Vandewetering. It runs locally on the operator's own machine. It has no
users other than the operator, collects nothing from anyone else, and operates
no server that the public can reach.

## What data exists, and where it lives

Everything stays on the operator's own computer, under the project's `data/`
folder:

- **Video and audio** the operator recorded, plus the clips derived from it.
- **Titles, captions, and schedules** the operator wrote or generated.
- **API credentials** for the operator's own social accounts — OAuth refresh
  tokens for YouTube and TikTok, and access tokens for Meta platforms — stored
  in local files (`.env`, `data/publisher-tokens.json`) that are excluded from
  version control.

## What is read from TikTok

With the operator's authorization, the app reads the operator's own basic
profile information (`user.info.basic` — open id, display name, avatar) to
label the connected account in the interface, and posts video to the operator's
own profile (`video.publish`, `video.upload`). Nothing else is requested, and
no other account's data is accessed.

## What is shared

Nothing is sold, rented, or shared. Data leaves the machine only when the
operator publishes a video, in which case it goes to the platform being
published to. Some caption and title text is sent to an AI provider
(DeepSeek or Anthropic) to be written; no credentials or personal data are
included in those requests.

## Retention and deletion

Data is kept until the operator deletes it. Deleting the local files removes
it. Revoking the app's access in TikTok settings invalidates its tokens
immediately; the operator can also delete `data/publisher-tokens.json` to
remove stored tokens.

## Contact

Questions about this policy: open an issue on this repository.
