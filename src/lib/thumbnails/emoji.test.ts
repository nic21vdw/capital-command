import assert from "node:assert/strict";
import { appleEmojiUrl, emojiCodepoints } from "./emoji";

// Single-codepoint emoji map to their lowercase hex codepoint.
{
  assert.equal(emojiCodepoints("🔥"), "1f525");
  assert.equal(emojiCodepoints("🚀"), "1f680");
  assert.equal(emojiCodepoints("✅"), "2705");
  assert.equal(emojiCodepoints("❌"), "274c");
  assert.equal(emojiCodepoints("⚡"), "26a1");
}

// The U+FE0F variation selector is dropped so it matches the Apple image keys.
{
  assert.equal(emojiCodepoints("✅️"), "2705");
}

// Multi-codepoint sequences are hyphen-joined.
{
  assert.equal(emojiCodepoints("👨‍🚀"), "1f468-200d-1f680");
}

// The CDN URL is built from the codepoints.
{
  assert.equal(appleEmojiUrl("🔥"), "https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-64/1f525.png");
}

console.log("emoji.test.ts passed");
