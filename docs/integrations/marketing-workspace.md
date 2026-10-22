# Private marketing workspace integration

The adapter now works locally against synthetic records in the original stores. It is **not connected or deployed to the running marketing service**. The hosted Site still reports unavailable capabilities. No production data, schedule, credential, account access or publication setting is changed.

## Implemented local composition

`createMarketingService`, `MarketingLedger`, `createYouTubeArtifactReader` and `createMarketingHttpHandlers` compose in the owning Node process. `installMarketingRuntime` explicitly installs trusted dependencies; without it the Next routes return the original closed capability response (GET) and HTTP 503 / executed false (POST). There is no environment switch, setup endpoint or caller-selected owner.

- Source creation persists an inert draft and durable command receipt in existing `runs.json`. It does not download, prepare, queue or schedule. Receipt-bearing rows survive normal history retention. Failed atomic saves do not become acknowledged in-memory drafts.
- Review, edit request, processing claim/outcome and safe retry metadata persist on existing publisher queue rows. There is no second publishing queue. The file store uses the same exclusive lock and atomic save for ordinary and managed transactions. Managed operation receipts survive deletion as tombstones. The unlocked R2 store is rejected.
- Exact targets bind owner, job, revision, actual artifact hash, full platform payload hash, final caption, account, platform, audience, visibility and scheduled time. Any changed revision invalidates review. Review does not set legacy approval or grant publication.
- The concrete artifact reader hashes real contained local video bytes, reuses the complete YouTube publisher plan, and rechecks file identity plus payload at the locked command. Other platform plans are incomplete for exact-review proof and are refused. No token refresh or provider call occurs.
- User HTTP accepts exact source, review, edit-request, safe processing-retry, original editor save/export-intent and preparation-intent commands. It enforces origin, trusted authentication, owner/scope, bounded JSON and complete command schemas. It cannot accept worker outcomes or trust an owner header. Callback authentication in tests is synthetic, not deployed identity.
- Worker outcomes use a separate trusted port and fenced attempt. Prepared/pre-send-failure require independent proof. Unknown outcomes remain uncertain; accepted receipts are retained, cannot be downgraded to retryable, and are reused for reconciliation. Published URLs require independently verified matching provider readback. No real provider verifier is wired.
- Managed rows are held outside legacy due, forced, Buffer, release and reconnect paths. Only a trusted internal adoption call can enroll an existing row; no user adoption API or production enrollment is performed.

`composeMarketingParity` adds explicitly enrolled saved sources/runs/jobs/clips/exports/schedules, original editor projects and scoped saved analytics. Protected media URLs resolve from trusted original record bindings; no generic file proxy or automatic enrollment exists. Original timeline/caption controls are ported to the Site. Saves retain complete original projects, CAS revisions and durable receipts in the original document; deleted projects stay hidden while their receipts remain reconcilable.

`createEditorPreparationWorker` reuses the original FFmpeg renderer without attachment or auto-enqueue. Synthetic composition tests exercise export request, internal claim, actual render, independent outcome proof and protected byte streaming. Uploaded source preparation creates a bounded local review proxy; it does not reproduce full URL ingestion or pipeline fanout. Original assets/SFX, project lifecycle, schedule controls, provider sync/readback and hosted transport still have gaps recorded in the fixed parity ledger.

## Concurrency and compatibility

Use one owning Node process. Pipeline draft/ordinary writes share a process-global serialization queue across Next module graphs. Queue mutations use strict file locks that never evict a known live holder solely for age. This does not make mixed old and new binaries safe co-writers. Do not run different release versions against a managed ledger, silently enroll originals, or retire the original system.

## Validation

`service.test.ts` exercises actual Next Request/Response routes, temporary FileQueueStore records, real byte hashing and the original pipeline draft persistence. The marketing suite covers durable replay/restart, failed saves, concurrency, stale targets, owner isolation, worker failures, uncertain outcomes, receipts and duplicate protection. The test setup isolates the data directory and clears app credentials; service tests prohibit all external fetches.

`scripts/verify-marketing-local.ts <empty-evidence-directory>` runs the installed Node/FFmpeg render helpers on generated test patterns and sine audio, burns real captions, creates actual video/poster previews, probes dimensions and hashes the output. It clears app credentials and rejects network fetches. This proves local media runtime support, not a connected worker or social publication.

## Remaining connection work

A deployed composition still needs an approved HTTPS transport to the existing owning service, verified Site identity mapped to an approved owner/account allowlist, narrow read/source/review/preparation scopes, authenticated artifact streaming and independent provider readback. No supported remote marketing route or existing transport grant was established during this task. Do not reuse a broad desktop control token or generic proxy. Installing these source changes in the existing service and provisioning persistent grants require separate authorization.

Keep the current configured daily cap untouched. Its deployed value is unknown here; the imported code default is two distinct videos/day and the historic preference was three. The Site exposes this discrepancy. One real stream-to-post acceptance test requires specific content, account and platform publication authorization. No cutover or migration is authorized.
# Stored image preparation

The optional stored-image resolver is installed by the owning process with an explicit existing EditorBinding and original store reader. Pass the same scoped resolver through `overlayAssets` to MarketingEditor, createEditorPreparationWorker and composeMarketingParity. No caller can provide a filesystem path, asset URL, owner binding or manifest. Missing configuration stays unavailable.

Only the existing project's content-addressed PNG/JPG/WebP references are supported. Resolve at most 32 assets, 8 MiB per file, 32 MiB compressed total, 8,192 pixels per axis and 16 MiPixels total before native decoding. PNG integrity and static-image checks run before rendering. Reject alias paths, symlinks/junctions, hardlinks, changed bytes, SVG, GIF and animated images. No uploads or source migration occur.

The original export intent stores the ordered immutable SHA-256 asset manifest. Request, claim, render, commit, restart proof and protected media each verify the matching project and bytes. Rendering copies verified bytes into private attempt scratch space and uses one input per original image, retaining timing across cuts. A streaming-only cache uses metadata guards after initial full validation; it cannot substitute for render/commit proof. Bounded timeline and command-size checks fail explicitly.

Browser DTOs redact original image sources and supply complete `media.overlays` opaque references. The Site hydrates only a preview copy; saves keep source fields omitted so the owning process restores the exact existing reference. Incomplete/duplicate/unknown mappings close the editor, and denied image bytes show an unavailable state. New image kinds or duplicates cannot be created through these controls. Hosted media remains unavailable until the separately approved transport and identity are installed.

## Cancellation and explicit restart contracts

An authenticated `cancel_editor_export` command names the exact current project target, request and optional claimed attempt. Its durable fence is written to that original project's export intent before any controller is signaled. Undispatched work can become canceled without creating an attempt. Claimed work remains `cancel_requested` until the trusted owning worker independently confirms the exact process epoch, attempt and saved cancellation fence after the whole callback and its subprocesses settle. A missing controller, kill failure or prior process is never proof of a successful stop. Deletion invalidates readiness but retains the original attempt and cancellation metadata; deletion itself does not cancel rendering.

The owning composition may pass the same preparation worker as `editorCancellation`. Its `abortExact` rechecks the saved fence and waits for a bounded interval; return alone is not a success assertion. Internal settlement has one deterministic command identity per explicit user cancellation. User receipts remain immutable and return `snapshot: null` with `refresh_required`, so source/media projection cannot delay a stop or hide a committed fence. The exact public command may be replayed without creating another internal receipt. No public route accepts settlement, epochs or outcome assertions.

After a slow close, a new explicit `reconcile_editor_export` can consume matching trusted settlement proof. An unconfirmed prior attempt remains uncertain. A separate explicit export request can link `supersedesRequestId` to that reconciled uncertain intent; it creates one fresh request and later a fresh attempt directory, preserving the old uncertainty and rejecting still-active ownership under the original store lock. Reads, module reconstruction and constructors never reconcile, requeue or restart work. These are local source contracts; hosted controls remain disabled and the matching Site contract/UI must be validated before enabling a connection.
