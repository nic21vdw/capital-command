# CoLateral Marketing performance batch

Repository: nic21vdw/capital-command.
Review base: 59454b4464665d1dde79b4fad78eb983d86542c3.
Integrated main through 8c5c60e60294fd530574e1c035f7784c95ccfb2e after #499 and #500 landed. Their source changes do not overlap this batch; the shared Unreleased changelog entries were preserved.
This batch is a draft. Source changes are not a release or measured speedup.

## Scope and ownership

Six GPT-6.1 Sol workers cover Shorts rendering, long-form rendering, streaming media memory, transcription, UI media playback, and FFmpeg subprocess management. The coordinator assembles and reviews the combined source.

## Prepared source changes

| Lane | Change | Source commit |
|---|---|---|
| Shorts | Skip hidden blur only when the existing probe proves all video streams are H.264; preserve default alpha/unknown/visible blur paths. | `d8a85aeb49b0fed33bd9f0d5cf97fc23b951d204` |
| Long-form | Seek past discarded opening footage for late body selections, retaining 60 seconds of preroll and shared video/audio selectors. | `8bd5b6daa0d913ce3d83f5796accf8c652f4837f` |
| Media memory | Stream fresh/resumed YouTube transfers, remove the metadata deadline from media PUTs, close streams, share yt-dlp initialization and clean partial uploads. | `daf8c2eb983db5589ec4e4abcbe0c1ce9fa6bd68` |
| Transcription | Bound failed-probe decodes, share a fair per-window decode/inference slot, use UUID scratch names and recover worker startup/runtime failures. | `9efbac9b8abac72421cfa0651d84b3fb77f6d07f` |
| UI | Remove covered preview fills and synchronize needed fills through pause, buffering, visibility and explicit paused scrubbing. | `5bb9a8c32e741624b66bd788dcbf777ccd6b2e1f` |
| Subprocesses | Stream complete energy records, bound diagnostic capture, control parser failures and close startup cancellation races. | `9dbf2899a13a3bad39ccbbb38f2763d86a756bf8` |

Cross-review found and corrected a worker-startup admission deadlock and a paused-preview scrub regression. Media streaming, FFmpeg lifecycle, render opacity guards and the corrected transcription lifecycle also received independent source review. These are source reviews, not executed acceptance tests.

Five source-extracted V8 checks passed for the late-body seek helper's opening/late/multiple-range/empty-input behavior and nonmutation. Six source-extracted opacity-parser checks passed in the render worker. These do not compile the TypeScript project or exercise FFmpeg.

## Execution status

The first source discovery used an old checkout under Documents. Current AGENTS.md identifies production as C:\Users\nic21\Repos\capital-command. Production was neither edited nor run.

New Windows commands failed after the execution permission profile supplied an invalid file:///workspace URI. File patching also failed. Desktop Commander reported no connected devices. The code was consequently prepared against the exact GitHub base through Git objects; no local typecheck, new test suite run, current-source render benchmark, or browser acceptance is claimed.

A small pre-blocker probe used older render code and cannot qualify the changed current-source pipeline. Its frame hashes and audio packet hash matched, but sample-aspect metadata differed and the cold wall times were not comparable. Do not cite it as the batch's performance gain.

The requested overnight schedule could not be established in its intended window: the scheduler rejected October 14's Toronto start as past and returned a relative start on October 15 instead. That schedule was paused after inspection. No unattended eight-hour Windows worker was started.

## Required qualification before marking ready

Use an isolated sandbox on the PR's exact combined head with empty/disarmed data and no real tokens. Keep heavy renders serial.

1. Run npm run typecheck and the focused regression files for the changes. Do not run a publishing CLI or a release script.
2. Run representative Shorts renders at the same resolution, frame rate, source, encoder, CRF/preset and output settings on base and head. Cover static/animated crop, visible center blur, odd dimensions/SAR, silent source and alpha-bearing media. Compare decoded pixels, stream geometry/color metadata and audio packet hashes.
3. Compare late-topic long-form renders on CFR and VFR sources, audio present/absent, hook present/absent, overlays/captions and kept ranges near boundaries. Inspect actual words at each cut, A/V sync, caption positions/timing, frame counts and final duration.
4. Exercise resumed uploads with exact byte offsets and Content-Range, a slow transfer lasting more than 20 seconds, a stream read failure, and an early server refusal. Verify file streams close and media bytes are not loaded as one Buffer.
5. Exercise simultaneous transcription requests, failed duration probes, EOF, a failed window followed by a successful request, and identical work directories. Confirm bounded windows, timestamp continuity and unchanged model/options.
6. In a browser verify native vertical files avoid redundant decoding, landscape center blur remains visible/synchronized, and play/pause/seeking/buffering/ended/visibility transitions behave correctly.
7. Measure warmed repeated wall time, CPU time and peak working set for a Short and an 8-12 minute long-form edit, and idle CPU with the app visible/hidden. Report medians and actual hardware/encoder details; do not extrapolate a tiny synthetic result to real productions.

Do not merge until required checks pass. The release is Nic's to run under AGENTS.md.
