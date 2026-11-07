# Handoff: X drafts auto-posted to Threads

Written 2026-11-07 for the agents on Nic's other Claude account. Read this, then
`CLAUDE.md` (section "X Drafts") and `AGENTS.md` in this repo.

## What Nic wants

- A steady stream of X posts in his voice. He picks the ones he likes and posts
  them to X **by hand**. Never post to X for him.
- Every draft also goes to **Threads automatically**, on a schedule.
- He uses it from his phone and from the CoLateral desktop Command Centre.
- Public persona rule: no post may call CoLateral a structural engineering tool
  or mention selling to engineering firms. His engineering work stays separate.
- Never handle tokens in chat. Nic livestreams.
- He is often away from his PC. Drive it with a Remote Control session on the
  device (folder `C:\Users\nic21\Documents`), over the app's HTTP API.

## What is built (capital-command PR #520, merged)

CoLateral Marketing (this repo) has an **X Drafts** screen at `/x-drafts`, under
Formats in the sidebar. Code is in `src/lib/x-drafts`.

- The Threads autopilot tick (every 5 minutes, Windows task "Capital Command
  threads autopilot") writes today's drafts if missing and tomorrow's after 5pm:
  7 posts, 8am to 8pm Eastern, every 2 hours. Writer is Opus via `claude -p` on
  Nic's machine, falling back to the configured models.
- Every draft passes `draftProblem` (named product in the hook, no link, max 480
  characters, brand rules, persona guard), then is booked on the Threads queue
  30 minutes after its X slot.
- The screen has Copy for X, Posted on X, Don't post (stops its Threads copy) and
  "Write drafts for <day>" to add another day.
- Phone page: if the R2 bucket has a public address (`S3_PUBLIC_BASE_URL`, set on
  the Podcast page), the list is uploaded as a phone page and its link shows on
  the screen.
- The Command Centre (CoLateral canvas) can drive it: "Write another day of
  drafts" and "Update the phone page".
- `.env` switches: `X_DRAFTS=off`, `X_DRAFTS_THREADS=off`, `X_DRAFTS_PER_DAY`,
  `X_DRAFTS_START`, `X_DRAFTS_THREADS_OFFSET_MINUTES`.
- Data: `data/x-drafts.json` and `data/threads-queue.json` in the production
  checkout. While the app runs, change them only through `/api/x-drafts` and
  `/api/threads`.

## State on 2026-11-07 (about noon Eastern)

1. **Threads has posted nothing since 2026-09-24.** The token for
   nic_vandewetering expired that day (HTTP 401, code 190). The autopilot still
   runs, but every post is skipped. Renewal: Meta developer dashboard, his app,
   Threads use case, Settings, User Token Generator, then CoLateral Marketing
   Settings, Accounts, Threads (or `THREADS_ACCESS_TOKEN` in `.env` and restart).
   Check with `POST http://localhost:3000/api/threads {"action":"check"}`.
2. **Release:** Nic asked for #520 to be installed remotely the same day. Check
   `GET http://localhost:3000/api/update` to see whether the running build has it.
3. **11 posts from the Nov 2-8 X schedule are on the Threads queue**, 12:30pm Sat
   Nov 7 through 6:30pm Sun Nov 8 Eastern. Any that come due while the token is
   dead are skipped, not posted late.
4. **Nic decided: cut the autopilot's own posts from 24 to 8 a day**
   (`THREADS_POSTS_PER_DAY=8` in the production `.env`).
5. Nic's PC may block `POST` calls to `localhost:3000` until he approves them.

## Next steps

1. Confirm the token check passes and a booked post reaches `published` with a
   `postId` (`GET /api/threads`). Report ids, never tokens.
2. After 5pm Eastern, confirm tomorrow's drafts were written
   (`GET /api/x-drafts`) and booked on Threads.
3. If the phone page says the bucket has no public address, walk Nic through the
   Podcast page setting.

## References

- Style findings: his best X posts compare Grok Bot, ChatGPT Dots and Claude Duet;
  usage limits and money are the strongest hooks; link-only plugs do badly, so
  links go in a self-reply.
- Production checkout: `C:\Users\nic21\Repos\capital-command`. Never edit it;
  code changes go through a sandbox worktree and a PR (see `AGENTS.md`).
