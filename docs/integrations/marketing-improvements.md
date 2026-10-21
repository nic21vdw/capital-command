# Parity versus improvements

Updated 2026-10-21. The fixed parity rubric lives in marketing-parity.md. These are separately qualified repairs, not substitutes for incomplete original workflows. All work is source/draft-only in the original service; no deployment, live rerender or publication occurred.

| Finding | Evidence / action | Status |
| --- | --- | --- |
| Lost-response retry could forget an earlier committed command after 401/403/409/422 | Exact UUID/payload retained through replay refusals and reauthentication; receipt reconciliation tested | Repaired locally |
| Intervening edit made old receipt permanently uncertain or falsely marked local draft saved | Separate immutable receipt from current snapshot; retain local recovery and require explicit current-version review | Repaired locally and synthetic browser checked |
| Deleted managed editor projects reappeared in original library | Preserve same-record receipt tombstone but hide from original public library/bootstrap/detail; prevent resurrection | Repaired locally |
| Burn captions switch ignored by original renderer | Paired FFmpeg outputs were identical with toggle on/off; shared ASS builder now honors toggle while retaining text overlays | Repaired with real decoded-output regression |
| Cut boundary resurrected removed frame and dropped kept frame | 10 fps ramps expected frames [0,1,4,5], got [0,1,2,4]; half-open multi-cut selection restores expected sequence | Repaired with original and preparation real-render regression |
| Preview seeks repeatedly hash whole source/output files | Bounded streaming-only cache rechecks current binding and file identity; repeat-read test performs zero hashes/probes; full hashing remains mandatory for render/commit | Repaired and independently reviewed; mutation/revocation tests pass |
| Limiter automatic level changes declared loudness | Actual synthetic AAC measured -13.05 LUFS before and -14.05 after disabling automatic output gain, within 0.2 LU of existing -14 house target | Repaired; 9 audio tests pass. This is not a universal platform requirement |
| Text-overlay preview/export diverge for width/font/background | Paired synthetic render outputs are identical despite these preview changes | Reproduced, not yet fixed |
| Word wholly inside a removed segment survives as zero-duration caption text | Keep only positive word intersections with retained speech; rebuild timed text after cuts; decoded plain/highlighted output matches kept-word reference | Repaired; untimed wording preserved |
| Active-word highlight covers gaps outside actual word timing | Partition events at actual word starts and ends; decoded gap frames match plain reference, active frames differ; ASS centisecond rollover corrected | Repaired with timing and real-render regressions |

No new platform technical limits, providers, posting policies or automatic schedules were encoded. Current official platform documentation must be verified before any platform-specific export rules change. Saved analytics remain saved measurements, not provider-fresh performance. Actual hosted connectivity is separately unconfigured and must be tested before capabilities are enabled.

The audio repair follows the [official FFmpeg alimiter documentation](https://ffmpeg.org/ffmpeg-filters.html#alimiter), checked 2026-10-21. Existing rendered files are preserved. Renderer behavior fixes take effect only on explicit rerender; existing signatures have no renderer-version field, so automatic invalidation is not claimed.

