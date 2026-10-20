# Private marketing workspace adapter boundary

Status: **disabled, no live connection**. This change adds a capability probe,
a pure projection of existing record types, and pure safety proposals. It does
not create, edit, approve, retry, publish, or record an outcome in any live store.
No token, OAuth grant, environment flag, task, schedule or new queue is added.

## HTTP contract delivered

- `GET /api/integrations/marketing/workspace` returns HTTP 200 with
  `{ connection: { state: "unavailable", message }, sources: [], jobs: [],
  policy, capabilities }`. Every capability is false. The configured daily cap
  is unknown (`null`), the imported code default is 2, and the historical user
  preference is separately labeled 3. None of these writes a setting.
- `POST /api/integrations/marketing/operations` always returns HTTP 503 with
  `{ error: { code: "connection_unavailable", message }, executed: false }`.
  It does not parse or dispatch the body. Reserved operation names are
  `create_source`, `request_edits`, `approve_job`, `retry_job` and
  `record_worker_outcome`; none is implemented as a write API.

Both responses set `Cache-Control: no-store`. The POST stays behind the existing
loopback mutation middleware. There is no remote-route exemption. That origin
check is not user authentication. The probe exposes no live records and is not
evidence that a worker is connected. The Site's `/api/workspace` and
`/api/operations`, or its authenticated MCP commands, may use the same response
shape; forwarding live operations is not authorized or installed here.

## Existing record projection

The projector uses the existing `PipelineRun`, `ClipJob` and `QueueItem` types
from their respective pipeline, clipping and publisher modules. A workspace
references those authoritative records; it does not create a second publishing
ledger. A clip job contains multiple candidates and a queue item contains
multiple platform legs. Their provenance ids are not workspace owner identity.

`projectExistingLedger` accepts only supplied typed snapshots. It imports no
store or worker at runtime. A future trusted reader must make owner-scoped
copies inside the app process; `Owned.ownerId` must come from verified connection
ownership, never an operation argument, URL parameter or social `accountId`.
The projector excludes other owners and does not return local media paths,
raw platform errors, tokens or invented published URLs. URLs containing
userinfo, query strings, fragments or non-HTTPS schemes are omitted. No URL is
fetched. Even HTTPS source URLs need owner-approved disclosure before a remote
reader is wired; a filename in a path can itself be private.

Projected job ids are `clip:<clipJobId>` and
`publish:<queueItemId>:<platform>`. These are view keys, not new ledger rows.
An existing clip job stays one aggregate job. It is not represented as one
approvable video. Legacy records expose `revision: 0` and
`revisionVerified: false` because timestamps do not prove monotonic transactional
revisions. All mutation capabilities remain false. `published` becomes
`reported_published` with `publishedUrlVerified: false`; a stored id is not a
fresh platform readback. Any attempted or started nonpublished leg requires
reconciliation, including a failed leg retaining an upload receipt.

## Pure safety kernel and handoff

`safety.ts` returns either a refusal or an **unpersisted proposal** with
`persisted: false`. No function executes work. Its caller must supply an already
authenticated principal and trusted current target. TypeScript types, matching
hash strings, and a caller-provided `PlatformReadback` object are not proof of
authentication, hashed media bytes, or a platform response.

The exact target binds owner, authoritative job id, monotonic revision,
artifact SHA-256, complete final payload SHA-256, final caption, platform,
account, visibility, audience and canonical scheduled time. The payload digest
must cover every publishing-relevant field after all transformations, including
title, hashtags, attribution, visibility and TikTok creator options. Re-rendering,
editing copy or options, changing time/account/platform, and any revision change
invalidate the old review. Digest generation and artifact verification are
deliberately not fabricated from filenames or legacy metadata here.

- A review proposal is `kind: "review_only", grantsPublishing: false`.
  User read/write permission and review approval do not grant social release.
- Edit proposals require write scope, a current exact target and bounded
  instructions, and require review invalidation in the eventual transaction.
- Retry proposals permit only a trusted failure **before sending**. Any claim,
  attempt, upload/container/post receipt, Buffer receipt or duplicate job/platform
  record blocks retry and editing. An absent receipt after a send error is not
  a verified pre-send failure. Account changes cannot evade the barrier.
- Worker assertions alone produce `uncertain`, even when the worker says
  `published` or `failed`. Independent authenticated platform readback must match
  owner/account, full target, revision, fenced attempt and post id, and be fresh.
  Accepted uploads and schedules remain `accepted`. A published proposal also
  requires matching actual visibility/audience and a canonical platform URL
  resolved to that post id by the independent reader. There is no implemented
  platform verifier or outcome recorder in this change.

## Required before enabling any operation

An explicitly authorized connection must implement and test all of the following
in the existing owning process/ledger, without changing posting behavior merely
because the workspace can read or write jobs:

1. Authenticated owner identity, narrow per-operation grants, approved transport
   and schemas; derive owner/account scope at the trusted boundary. Do not
   expose generic URL/file access, a generic route proxy, credentials or an
   `x-owner-id` trust shortcut.
2. A side-effect-free snapshot path. Do not call `runOverview`, `advanceRun`,
   pipeline GET, `enqueue`, booking, heartbeat or publishing to obtain status.
3. Durable monotonic revisions and compare-and-set on the existing record,
   checked under the same lock/transaction as the write. Current file timestamps,
   merge saves and unconditional object writes are not adequate CAS.
4. A durable command-id receipt, bound to owner and the complete request. Replays
   return the saved result; a reused id with changed args is rejected. Atomically
   enforce one delivery per authoritative output/job/platform/account, retain
   receipt tombstones, and fence every worker claim. A random id alone is not
   an implemented dedupe guarantee.
5. Verified artifact bytes and final payload, exact review binding and atomic
   invalidation when anything changes. Keep review separate from an explicit
   publication grant. No such publication grant is provided by this task.
6. Bounded authenticated worker-result recording in that same ledger. Persist
   attempt identity before sending; reconcile unknown send/save outcomes before
   retry. Store accepted/scheduled/published distinctly and verify URLs/accounts
   and visibility through platform reads. Never let a generic retry re-upload
   failed rows that still have receipts.

Until those requirements are met, create/update/review/retry/outcome writes are
unavailable. The synthetic tests exercise proposals and projections only. They
do not claim a live connection, an atomic ledger write or a social post.
