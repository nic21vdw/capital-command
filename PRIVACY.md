# Privacy Policy

**Last updated: August 19, 2026**

The canonical copy of this policy is the one published with the product, in
`site/privacy.html`. This file mirrors it so the repository and the site never
say different things.

Capital Command is software you install and run on a computer you control. It
is not a hosted service. There is no Capital Command server that your videos,
captions, schedule or access tokens are sent to, and no operator of this
software can see them.

## Who is responsible for your data

Whoever runs an installation controls the data in it. If you installed it, that
is you.

## What the software stores

- **Access and refresh tokens** for the platform accounts you connect, so it
  can post on your behalf at a scheduled time without asking you to sign in
  again.
- **Basic profile details** of each connected account — display name, username
  and avatar — so the interface can show which account a post is going to.
- **Your media and captions**: the long-form video you supply, the clips cut
  from it, the thumbnails, and the text written for each post.
- **Your schedule**: which clip goes to which account, at what time, with which
  per-post settings.
- **Records of what was posted**, including the identifier a platform returns,
  so the same clip is not published twice.

All of it is written to a folder on the machine running the software, or to
storage you configured with your own credentials. None of it is transmitted
anywhere except to the platform APIs you connected, to carry out the actions
you scheduled.

## Data read from TikTok

- `user.info.basic` — reads display name, username and avatar so the app can
  label the connected account and the posts booked to it. Stored locally,
  shown only to you.
- `video.publish` — publishes a clip to your profile at the scheduled time,
  with the audience, comment, duet, stitch and commercial-content settings you
  selected for that clip. Immediately before each post the software re-reads
  your current posting settings from TikTok, so an option you have since
  disabled is not used.
- `video.upload` — sends a clip to your TikTok inbox as a draft for you to
  finish and post yourself.

Information obtained from TikTok is not sold, rented, shared with any third
party, used for advertising or profiling, or combined with data from other
sources. It is not used to train machine-learning models.

## What is never collected

No analytics, no telemetry, no crash reporting, no usage tracking. It does not
collect your contacts, followers, direct messages, location, payment details,
or the content of accounts you have not connected.

## Third parties

The only services your copy talks to are the ones you set up: the platform APIs
for accounts you connected, and any optional storage or AI provider you
configured with your own API key.

## Retention and deletion

Data stays until you remove it. Delete a stored token in the software, revoke
access in the platform's own settings, or delete the data folder — any of these
ends the software's access to that account. Deleting local data does not remove
posts already published; those are removed in the platform itself.

## Children

Not intended for anyone under the age required to hold an account on the
platforms it connects to.

## Contact

nic21vdw@gmail.com
