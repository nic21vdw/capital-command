# Live voice

Talk to Capital Command. `/agents` opens a speech-to-speech session with
OpenAI Realtime or Grok Voice, and the model can call a small set of app tools
while you are talking — the one that matters is "is there a new stream on my
channel, and if so put it through the pipeline".

## Subscription first, API key second

Grok Voice runs on a **SuperGrok / X Premium sign-in**, not on API top-ups.
`xaiAuth.ts` holds the OAuth device-code flow against `auth.x.ai` (client id
`b1a00492-…`, scope includes `api:access`), stores the tokens in
`data/voice/xai-oauth.json`, and refreshes them. A client secret minted with
that access token is billed against the subscription. `XAI_API_KEY` is only the
fallback when nobody is signed in.

Two ways in, both server-side because `auth.x.ai` sends no CORS headers — in
CoLateral that needed a Local Bridge; here the Next server *is* the bridge:

- **Import the Grok CLI's session.** If `~/.grok/auth.json` holds a sign-in for
  the same issuer and client id, one click adopts it. It is refreshed before
  being stored — a CLI session whose refresh token has since rotated would
  otherwise import cleanly and fail at the first mint, which reads as "the voice
  feature is broken" rather than "sign in again".
- **Device code.** The console shows a code, `accounts.x.ai` takes the approval,
  and the app polls until it lands.

OpenAI has no equivalent: ChatGPT Plus does not cover the realtime API, so that
provider is genuinely pay-as-you-go and needs `OPENAI_API_KEY`. It is kept as a
second option, not the default — the console prefers whichever provider is on a
subscription.

## The key never reaches the browser

A browser cannot set an `Authorization` header on a websocket, so both vendors
take the credential in the websocket subprotocol. That is why `OPENAI_API_KEY`
and `XAI_API_KEY` are exchanged **server-side** for a short-lived session secret
(`POST /api/voice/session` → the vendor's `client_secrets` endpoint), and only
that secret goes to the page. Nothing here ever ships a real key to a client.

`/api/voice/session` also builds the whole `session.update` payload, so every
provider quirk stays on the server where it can be tested in Node:

- OpenAI nests turn detection under `audio.input` and the voice under
  `audio.output`; xAI wants `voice` and `turn_detection` at the session root.
  Putting OpenAI's nesting on xAI can leave output audio never enabled.
- Both want mono PCM16 at 24 kHz, base64, in `input_audio_buffer.append`.

## Audio

`pcm.ts` is the maths (resample, pack, base64) with no DOM in it, so it is unit
tested. `audio.ts` is the browser half: an AudioWorklet capture graph, and a
playback queue that **schedules each chunk against a running cursor** rather
than playing it on arrival — chunks arrive faster than realtime and playing
them as they land overlaps them into noise. The cursor also makes barge-in
exact: speech-started cancels every buffer that has not started yet.

## Tools, and the safety line

`tools.ts` is the allowlist. Every tool is either read-only or an action, and
the action tools are **not loaded into the session at all** unless the console
is armed — the model cannot call what it was never given. `/api/voice/tool`
re-checks that server-side against a grant minted with the session, so an
edited page cannot promote itself.

| Tool | |
| --- | --- |
| `sourceflow_state`, `list_pipeline_runs`, `pipeline_run_status` | read |
| `channel_check`, `ingest_status`, `agent_run_status` | read |
| `start_channel_ingest`, `start_pipeline`, `run_agent_team` | action |

Publishing, scheduling, deletes, token changes and scheduled-task registration
are **not tools**, armed or not. The action set is exactly the work that stops
at "ready for Nic to review" — the same line the Sourceflow agent team and the
unattended channel scan already hold. Adding anything past that line needs its
own fail-closed approval design, not another entry in this table.

Long jobs return an id immediately and are polled (`ingest_status`,
`pipeline_run_status`), because a voice turn cannot wait four hours for a stream
to fan out.
