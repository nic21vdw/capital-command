# Saved video looks

Clip Editor > Style > Your video looks keeps reusable caption presentation in
the existing brand kit. Style an edit, select **Save current look**, name it,
and optionally add editing guidance. Up to 12 looks can be saved. Settings >
Brand kit lists the same collection and links back to the editor.

Open a saved look in another edit to compare its captions with that edit's
current settings. The comparison uses the edit's first enabled caption, or
clearly labelled sample words. It is a sample frame, not an encoded video.
**Apply to this edit** changes caption style, visibility, current-word
highlighting and the caption burn preference. The editor's existing autosave
and Undo handle that change.

Applying does not change media, words, timing, cuts, framing, overlays, audio,
custom caption offsets, export destination or other export settings. Saving,
editing or removing a look does not update any existing project. To change a
saved style, capture a new look from a styled edit; **Edit details** changes
only its name and guidance.

**Copy editing brief** carries the look's presentation summary and guidance
into ChatGPT or another editing workflow. Guidance is manual direction, not a
renderer setting. Nothing in this flow generates, exports, schedules or
publishes a video, and a saved preference is not proof of rendering.

## Persistence

`videoLooks` is an additive field in `data/brand-kit.json`. Older kits resolve
to an empty collection. No project storage keys or routes change.

The editor uses a scoped `PATCH /api/brand-kit` containing `videoLooks` and
`expectedOverrides` from the most recent successful read. The existing
Settings `PUT` also sends that snapshot. A file lock serializes writes; the
snapshot is checked again under the lock before atomic replacement. A stale
write returns 409, and unreadable or invalid existing files are left intact.
The editor keeps draft notes during a failed save and lets the user reload
the current kit before retrying. Existing server callers without a snapshot
remain compatible.

## Verification scope

Focused tests cover legacy kits, presentation-only capture/application,
client read/write failures, persisted API reloads, concurrent writes and
byte-for-byte preservation of invalid files. The local browser check uses
original synthetic media and isolated data with workers and external requests
disabled. It exercises save/reload, cancel/back/Escape, side-by-side comparison,
apply/Undo/reapply, conflict recovery, failed-save recovery, brief copying,
Settings discovery, removal, light and dark themes, and a 390px viewport.

This verifies the editor preview and settings transport. Encoder output is
outside this change; it continues to use the existing renderer and export
controls.
