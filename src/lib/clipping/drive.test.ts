import assert from "node:assert/strict";
import { sanitizeFolderName } from "./drive";

// Strips characters Windows/macOS reject in folder names.
assert.equal(sanitizeFolderName('Stream: "Best" of <2024>'), "Stream Best of 2024");

// Collapses whitespace and trims.
assert.equal(sanitizeFolderName("  My   Big    Stream  "), "My Big Stream");

// Drops a trailing dot/space that Windows would silently strip.
assert.equal(sanitizeFolderName("Episode 12."), "Episode 12");

// Keeps ordinary punctuation like hyphens intact.
assert.equal(sanitizeFolderName("Live - Q&A night"), "Live - Q&A night");

// Falls back when nothing usable remains.
assert.equal(sanitizeFolderName("///"), "Untitled stream");
assert.equal(sanitizeFolderName("   "), "Untitled stream");

// Caps very long titles so the path stays valid.
assert.ok(sanitizeFolderName("a".repeat(300)).length <= 120);
