/**
 * Apple emoji, everywhere, drawn as pictures rather than typed as glyphs.
 *
 * `fillText` draws whatever emoji font the machine has: Apple Color Emoji on a
 * Mac, Segoe UI Emoji on Windows, and — the case that actually bit — NOTHING AT
 * ALL on the server, where `@napi-rs/canvas` has no emoji font to fall back to
 * and every 🚀 in a booked carousel came out as empty space. So the glyphs are
 * cut out of the copy and drawn from the open `iamcal/emoji-data` Apple image
 * set instead, which also makes a slide look the same wherever it was painted.
 *
 * This file is pure: splitting text into runs and naming an image. Fetching one
 * is the caller's job, because the browser and the server get there differently.
 */

const APPLE_BASE = "https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-64";

/**
 * One emoji, as Unicode defines one.
 *
 * The presentation rule is load-bearing: `\p{Extended_Pictographic}` alone also
 * matches ©, ® and ™, which are typed as text and would be swapped for a picture
 * mid-sentence. A character only counts as emoji if it defaults to emoji
 * presentation, or if the copy asked for it with U+FE0F.
 */
const ATOM = "(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)(?:[\\u{1F3FB}-\\u{1F3FF}])?";
const KEYCAP = "[0-9#*]\\uFE0F?\\u20E3";
const FLAG = "\\p{RI}\\p{RI}";
/** Subdivision flags spell their region out in invisible tag characters. Left
 *  behind in the text run they are unprintable rubbish inside a word. */
const TAGS = "(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})?";
const EMOJI_SOURCE = `(?:${FLAG}|${KEYCAP}|${ATOM}${TAGS}(?:\\u200D${ATOM}${TAGS})*)`;

export function emojiPattern(): RegExp {
  return new RegExp(EMOJI_SOURCE, "gu");
}

/**
 * Converts an emoji to its hyphen-joined lowercase codepoints, matching the
 * `emoji-data` image filenames. U+FE0F is dropped, since the Apple image set
 * keys single-codepoint emoji without it; the ZWJ inside a sequence is kept,
 * because those files are named with it.
 */
export function emojiCodepoints(emoji: string): string {
  return Array.from(emoji)
    .map((ch) => ch.codePointAt(0) ?? 0)
    .filter((cp) => cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join("-");
}

/** CDN URL for the Apple-styled PNG of an emoji glyph. */
export function appleEmojiUrl(emoji: string): string {
  return `${APPLE_BASE}/${emojiCodepoints(emoji)}.png`;
}

/**
 * Every name the image set might file a glyph under, best guess first.
 *
 * There is no rule to derive here, so the fallback IS the rule, and each of
 * these was a glyph that came out blank until it was added:
 *
 * - U+FE0F is KEPT for the emoji whose canonical sequence carries it and dropped
 *   for the rest. 🛠️ is `1f6e0-fe0f.png` and ❤️ is `2764-fe0f.png`, while 💡 is
 *   plain `1f4a1.png` — and 🛠️ is one of the emoji the slide prompt asks for by
 *   name, so stripping unconditionally cost a picture on real decks.
 * - Codepoints below U+1000 are ZERO-PADDED to four hex digits. 1️⃣ is
 *   `0031-fe0f-20e3.png`, not `31-fe0f-20e3.png`, which is every keycap — and a
 *   keycap is what a numbered listicle slide is made of.
 */
export function appleEmojiUrls(emoji: string): string[] {
  const points = Array.from(emoji).map((ch) => ch.codePointAt(0) ?? 0);
  const name = (keep: boolean, pad: boolean) =>
    points
      .filter((cp) => keep || cp !== 0xfe0f)
      .map((cp) => (pad ? cp.toString(16).padStart(4, "0") : cp.toString(16)))
      .join("-");
  const names: string[] = [];
  for (const keep of [false, true]) {
    for (const pad of [false, true]) {
      const candidate = name(keep, pad);
      if (!names.includes(candidate)) names.push(candidate);
    }
  }
  return names.map((entry) => `${APPLE_BASE}/${entry}.png`);
}

/** The key an emoji's decoded picture is filed under alongside slide images. */
export function emojiImageKey(emoji: string): string {
  return `emoji:${emojiCodepoints(emoji)}`;
}

export type TextRun = { emoji: false; text: string };
export type EmojiRun = { emoji: true; text: string };
export type Run = TextRun | EmojiRun;

/**
 * Splits copy into alternating stretches of text and single emoji, so a line can
 * be measured and painted piece by piece. Text runs keep their spacing exactly:
 * the emoji is lifted out of the sentence, not the space around it.
 */
export function splitRuns(text: string): Run[] {
  const runs: Run[] = [];
  const pattern = emojiPattern();
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) runs.push({ emoji: false, text: text.slice(last, at) });
    runs.push({ emoji: true, text: match[0] });
    last = at + match[0].length;
  }
  if (last < text.length) runs.push({ emoji: false, text: text.slice(last) });
  return runs;
}

/** Every distinct emoji in a piece of copy, in the order they first appear. */
export function emojiIn(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(emojiPattern())) {
    if (!seen.has(match[0])) seen.add(match[0]);
  }
  return [...seen];
}

/** Whether a string contains anything that will be drawn as a picture. */
export function hasEmoji(text: string): boolean {
  return emojiPattern().test(text);
}
