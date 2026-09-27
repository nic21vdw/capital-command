import type { CaptionPresetId, CaptionSegment, CaptionStyle, CaptionWord } from "@/types/domain";

// --- Time formatting -------------------------------------------------------

/** Parses an `HH:MM:SS.mmm` / `MM:SS.mmm` timestamp to seconds. */
export function parseTimestamp(value: string): number {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function pad(n: number, width = 2) {
  return String(Math.floor(n)).padStart(width, "0");
}

function clock(seconds: number, sep: "," | ".") {
  const s = Math.max(0, seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(ms, 3)}`;
}

export const formatSrtTime = (s: number) => clock(s, ",");
export const formatVttTime = (s: number) => clock(s, ".");

/** ASS uses centiseconds: `H:MM:SS.cc`. */
export function formatAssTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${hh}:${pad(mm)}:${pad(ss)}.${pad(cs)}`;
}

// --- VTT / SRT parsing -----------------------------------------------------

const TS_INLINE = /<(\d{1,2}:\d{2}:\d{2}[.,]\d{3})>/g;
const TAG = /<[^>]+>/g;

// Subtitle text arrives HTML-escaped (VTT inherits HTML escaping; YouTube in
// particular encodes the ">>" speaker-change marker as "&gt;&gt;"). Decoding
// must happen AFTER tag stripping so a decoded "<"/">" can't be eaten as a tag.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

// Non-speech caption furniture: bracketed sound tags like [Music], [Applause],
// [ __ ] (YouTube's profanity mask) and ">>"/">>>" speaker-change chevrons.
// None of it is spoken audio, so it never belongs in burned captions.
const SOUND_TAG = /\[[^\]]*\]/g;

/** Cue text -> clean spoken tokens: strip tags, decode entities, drop noise. */
function cleanTokens(text: string): string[] {
  return decodeHtmlEntities(text.replace(TAG, ""))
    .replace(SOUND_TAG, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^>+/, ""))
    .filter(Boolean);
}

type RawCue = { start: number; end: number; raw: string };

function readCues(content: string): RawCue[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const cues: RawCue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})/);
    if (!m) continue;
    const start = parseTimestamp(m[1]);
    const end = parseTimestamp(m[2]);
    const text: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ""; j++) text.push(lines[j]);
    cues.push({ start, end, raw: text.join("\n") });
  }
  return cues;
}

/** Extracts word-level timing from a cue body that carries inline timestamps. */
function wordsFromCue(cue: RawCue): CaptionWord[] {
  const words: CaptionWord[] = [];
  // Split on inline timestamps, keeping the timestamps so each chunk gets a start.
  const segments = cue.raw.split(TS_INLINE);
  // segments: [textBeforeFirstTs, ts1, text1, ts2, text2, ...]
  let currentStart = cue.start;
  for (let i = 0; i < segments.length; i++) {
    const isTimestamp = i % 2 === 1;
    if (isTimestamp) {
      currentStart = parseTimestamp(segments[i]);
      continue;
    }
    for (const token of cleanTokens(segments[i])) {
      words.push({ text: token, start: currentStart, end: currentStart });
    }
  }
  return words;
}

/**
 * Parses WebVTT or SRT into a continuous, de-duplicated word stream. Handles
 * YouTube auto-caption "rolling" cues (which repeat text) by keying words on
 * their timestamp, and recovers per-word timing where the source provides it.
 */
export function parseSubtitleWords(content: string): CaptionWord[] {
  const cues = readCues(content);
  const hasInline = TS_INLINE.test(content);
  TS_INLINE.lastIndex = 0;

  const words: CaptionWord[] = [];
  if (hasInline) {
    const seen = new Set<string>();
    for (const cue of cues) {
      for (const w of wordsFromCue(cue)) {
        const key = `${w.text}@${w.start.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        words.push(w);
      }
    }
  } else {
    // No per-word timing: spread each cue's words evenly across its duration.
    for (const cue of cues) {
      const tokens = cleanTokens(cue.raw);
      if (tokens.length === 0) continue;
      const step = (cue.end - cue.start) / tokens.length;
      tokens.forEach((text, idx) => {
        const start = cue.start + step * idx;
        words.push({ text, start, end: start + step });
      });
    }
  }

  words.sort((a, b) => a.start - b.start);
  // Close open word ends against the next word's start.
  for (let i = 0; i < words.length; i++) {
    if (words[i].end <= words[i].start) {
      words[i].end = i + 1 < words.length ? Math.max(words[i].start, words[i + 1].start) : words[i].start + 0.4;
    }
  }
  return words;
}

const SENTENCE_END = /[.!?]$/;

/** Groups a word stream into readable phrase segments. */
export function chunkWords(words: CaptionWord[], maxWords = 7): CaptionSegment[] {
  const segments: CaptionSegment[] = [];
  let bucket: CaptionWord[] = [];
  const flush = () => {
    if (bucket.length === 0) return;
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    segments.push({
      id: `cap-${segments.length + 1}`,
      start: first.start,
      end: Math.max(last.end, first.start + 0.3),
      text: bucket.map((w) => w.text).join(" "),
      words: bucket.map((w) => ({ ...w })),
      enabled: true
    });
    bucket = [];
  };
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    bucket.push(word);
    const nextStart = words[i + 1]?.start ?? word.end;
    if (bucket.length >= maxWords || SENTENCE_END.test(word.text) || nextStart - word.end > 1.2) flush();
  }
  flush();

  // A segment must never linger past the next one's start: overlapping phrases
  // make the live caption stick on a stale line while the following phrase has
  // nothing on screen. Shrink (never extend) each end down to the next start so
  // exactly one segment is ever active at a time. Real pauses are preserved —
  // this only trims genuine overlaps.
  for (let i = 0; i < segments.length - 1; i++) {
    const next = segments[i + 1];
    if (segments[i].end > next.start) {
      segments[i].end = Math.max(segments[i].start + 0.05, next.start);
    }
  }
  return segments;
}

/** Full pipeline: subtitle file text -> phrase segments with word timing. */
export function parseSubtitles(content: string, maxWords = 7): CaptionSegment[] {
  return chunkWords(parseSubtitleWords(content), maxWords);
}

// --- Clip-local windowing --------------------------------------------------

/**
 * Shifts source-relative segments into clip-local time and keeps only those
 * overlapping [clipStart, clipEnd]. Used when a clip is a slice of a VOD.
 */
export function windowSegments(segments: CaptionSegment[], clipStart: number, clipEnd: number): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  for (const seg of segments) {
    if (seg.end <= clipStart || seg.start >= clipEnd) continue;
    const start = Math.max(0, seg.start - clipStart);
    const end = Math.min(clipEnd, seg.end) - clipStart;
    const words = seg.words
      .filter((w) => w.end > clipStart && w.start < clipEnd)
      .map((w) => ({
        text: w.text,
        start: Math.max(0, w.start - clipStart),
        end: Math.min(clipEnd, w.end) - clipStart
      }));
    out.push({ ...seg, id: `cap-${out.length + 1}`, start, end, words });
  }
  return out;
}

// --- Editing operations ----------------------------------------------------

export function splitSegment(seg: CaptionSegment, atSeconds: number): [CaptionSegment, CaptionSegment] {
  const at = Math.min(Math.max(atSeconds, seg.start + 0.05), seg.end - 0.05);
  const left = seg.words.filter((w) => w.start < at);
  const right = seg.words.filter((w) => w.start >= at);
  const mk = (words: CaptionWord[], start: number, end: number, fallback: string): CaptionSegment => ({
    id: `cap-${crypto.randomUUID().slice(0, 8)}`,
    start,
    end,
    text: words.length ? words.map((w) => w.text).join(" ") : fallback,
    words,
    enabled: seg.enabled
  });
  const allTokens = seg.text.split(/\s+/);
  return [
    mk(left, seg.start, at, allTokens.slice(0, Math.ceil(allTokens.length / 2)).join(" ")),
    mk(right, at, seg.end, allTokens.slice(Math.ceil(allTokens.length / 2)).join(" "))
  ];
}

/**
 * Re-tokenizes a segment's text into evenly-timed words across its span. Used
 * when the caption text is edited by hand (per-segment box or the combined
 * transcript box) so word-level highlighting tracks the new wording instead of
 * the stale transcript timing. Even distribution is the right call here: once
 * the words change, the original per-word timings no longer map to anything.
 */
export function retimeWords(seg: CaptionSegment, text: string): CaptionWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const span = Math.max(0.05, seg.end - seg.start);
  const step = span / tokens.length;
  return tokens.map((token, i) => ({
    text: token,
    start: seg.start + step * i,
    end: seg.start + step * (i + 1)
  }));
}

export function mergeSegments(a: CaptionSegment, b: CaptionSegment): CaptionSegment {
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  return {
    id: first.id,
    start: first.start,
    end: Math.max(first.end, second.end),
    text: `${first.text} ${second.text}`.trim(),
    words: [...first.words, ...second.words],
    enabled: first.enabled
  };
}

// --- Serialization ---------------------------------------------------------

export function serializeSrt(segments: CaptionSegment[]): string {
  return (
    segments
      .filter((s) => s.enabled && s.text.trim())
      .map((s, i) => `${i + 1}\n${formatSrtTime(s.start)} --> ${formatSrtTime(s.end)}\n${s.text.trim()}`)
      .join("\n\n") + "\n"
  );
}

export function serializeVtt(segments: CaptionSegment[]): string {
  return (
    "WEBVTT\n\n" +
    segments
      .filter((s) => s.enabled && s.text.trim())
      .map((s) => `${formatVttTime(s.start)} --> ${formatVttTime(s.end)}\n${s.text.trim()}`)
      .join("\n\n") +
    "\n"
  );
}

// --- ASS generation for burn-in --------------------------------------------

/** `#rrggbb` (or `#rrggbbaa`) -> ASS `&HAABBGGRR`. alphaOverride 0..1 = opaque..clear. */
function assColor(hex: string, alphaOverride?: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2) || "ff", 16);
  const g = parseInt(clean.slice(2, 4) || "ff", 16);
  const b = parseInt(clean.slice(4, 6) || "ff", 16);
  const aHex = clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) : 0;
  const alpha = alphaOverride === undefined ? aHex : Math.round((1 - alphaOverride) * 255);
  const h = (n: number) => pad2hex(n);
  return `&H${h(alpha)}${h(b)}${h(g)}${h(r)}`;
}

function pad2hex(n: number) {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0").toUpperCase();
}

function assAlignment(style: CaptionStyle): number {
  // ASS numpad alignment: 1-3 bottom, 4-6 middle, 7-9 top.
  const col = style.alignment === "left" ? 1 : style.alignment === "right" ? 3 : 2;
  if (style.position === "top") return 6 + col; // 7,8,9
  if (style.position === "middle") return 3 + col; // 4,5,6
  return col; // bottom / lower-third
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");
}

/**
 * Builds an ASS subtitle document for FFmpeg burn-in. Honors font, size,
 * weight, colors, outline, shadow, alignment/position and karaoke-style
 * current-word highlighting.
 */
export function buildAss(
  segments: CaptionSegment[],
  style: CaptionStyle,
  width: number,
  height: number,
  highlightCurrentWord: boolean
): string {
  const fontSize = Math.round(style.fontScale * height);
  const marginV = Math.round(style.position === "lower-third" ? height * 0.18 : height * 0.06);
  const primary = assColor(style.textColor);
  const outline = assColor("#000000");
  const back = assColor(style.backgroundColor, style.backgroundOpacity);
  const fontName = style.fontFamily.split(",")[0].trim();
  const bundled = isBundledCaptionFont(style.fontFamily);
  const bold = bundled ? 0 : style.fontWeight >= 600 ? -1 : 0;
  const italic = style.italic ? -1 : 0;
  const titleFont = bundled ? "Montserrat ExtraBold" : fontName;
  // BorderStyle 3 paints an opaque box behind text when a background is wanted.
  const boxed = style.backgroundOpacity > 0.02;
  const borderStyle = boxed ? 3 : 1;
  const boxOutline = boxed ? back : outline;
  const outlineWidth = boxed ? Math.max(style.outlineWidth, Math.round(fontSize * 0.18)) : style.outlineWidth;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},${primary},${assColor(style.highlightColor)},${boxOutline},${back},${bold},${italic},0,0,100,100,0,0,${borderStyle},${outlineWidth},${style.shadow},${assAlignment(style)},40,40,${marginV},1`,
    // Dedicated watermark style: drop-shadow outline (BorderStyle 1), never an
    // opaque caption box, so the CoLateral lockup stays legible on any frame.
    `Style: Watermark,${titleFont},${Math.max(10, Math.round(height * 0.03))},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,2,1,40,40,40,1`,
    // Dedicated clip-title style: bold white with a clean drop-shadow outline
    // (never a caption box), used by buildClipTitleDialogue for the headline
    // burned above the video band on every rendered clip.
    `Style: Title,${titleFont},${Math.max(12, Math.round(height * 0.034))},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,60,60,60,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];

  const highlight = assColor(style.highlightColor);
  const wordsPerLine = Math.max(1, style.wordsPerLine);
  const transform = (word: string) => escapeAss(style.uppercase ? word.toUpperCase() : word);
  // Pop-in: the phrase lands at 90% and springs to full size in ~110 ms.
  const popIn = "{\\fscx90\\fscy90\\t(0,110,\\fscx100\\fscy100)}";
  const entrance = style.animation === "fade" ? "{\\fad(150,150)}" : style.animation === "pop" ? popIn : "";
  // Drag-placed captions carry a normalized center; anchor every event there
  // (\an5 = center anchor) so the burn-in matches the preview exactly.
  const posTag =
    style.offsetX !== undefined && style.offsetY !== undefined
      ? `{\\an5\\pos(${Math.round(style.offsetX * width)},${Math.round(style.offsetY * height)})}`
      : "";
  const glow = style.glowColor
    ? `\\1a&HFF&\\3c${assColor(style.glowColor)}\\3a&H40&\\bord${Math.max(6, Math.round(fontSize * 0.12))}\\blur${Math.max(8, Math.round(fontSize * 0.2))}\\shad0`
    : "";

  const events: string[] = [];
  const pushEvent = (start: number, end: number, text: string) => {
    const times = `${formatAssTime(start)},${formatAssTime(end)}`;
    if (glow) {
      const glowText = text.replaceAll("{\\r}", `{\\r${glow}}`).replaceAll("\\alpha&H70&", "\\3a&HC0&");
      events.push(`Dialogue: 0,${times},Default,,0,0,0,,${posTag}{${glow}}${glowText}`);
    }
    events.push(`Dialogue: ${glow ? 1 : 0},${times},Default,,0,0,0,,${posTag}${text}`);
  };
  for (const seg of segments) {
    if (!seg.enabled || !seg.text.trim()) continue;

    if (highlightCurrentWord && seg.words.length > 0) {
      // Word-synced captions the way clip apps burn them: one dialogue event
      // per spoken word showing the WHOLE phrase, with the current word
      // re-colored (and popped slightly larger). "karaoke" keeps already
      // spoken words lit and dims upcoming ones for a progressive fill.
      const words = [...seg.words].sort((a, b) => a.start - b.start);
      const karaoke = style.animation === "karaoke";
      for (let i = 0; i < words.length; i++) {
        const eventStart = i === 0 ? seg.start : Math.max(seg.start, words[i].start);
        const eventEnd = i === words.length - 1 ? seg.end : Math.min(seg.end, Math.max(eventStart + 0.01, words[i + 1].start));
        if (eventEnd <= eventStart) continue;
        const text = words
          .map((w, j) => {
            const breakTag = j > 0 && j % wordsPerLine === 0 ? "\\N" : j > 0 ? " " : "";
            let styled: string;
            if (j === i) {
              const popTag = style.animation === "pop" || karaoke ? "\\fscx112\\fscy112" : "";
              styled = `{\\1c${highlight}${popTag}}${transform(w.text)}{\\r}`;
            } else if (karaoke && j < i) {
              styled = `{\\1c${highlight}}${transform(w.text)}{\\r}`;
            } else if (karaoke && j > i) {
              styled = `{\\alpha&H70&}${transform(w.text)}{\\r}`;
            } else {
              styled = transform(w.text);
            }
            return breakTag + styled;
          })
          .join("");
        // Entrance animation only on the first event so the phrase pops once.
        const prefix = i === 0 ? entrance : "";
        pushEvent(eventStart, eventEnd, `${prefix}${text}`);
      }
      continue;
    }

    const tokens = seg.text.trim().split(/\s+/);
    const text = tokens.map((tok, j) => (j > 0 && j % wordsPerLine === 0 ? "\\N" : j > 0 ? " " : "") + transform(tok)).join("");
    pushEvent(seg.start, seg.end, `${entrance}${text}`);
  }

  return `${header.join("\n")}\n${events.join("\n")}\n`;
}

/**
 * A single ASS dialogue line for a positioned text overlay. Uses inline
 * override tags so each overlay is fully self-styled regardless of the
 * Default style: anchor-centered (\an5), absolute position, rotation, size.
 */
export function buildTextOverlayDialogue(
  text: string,
  opts: {
    x: number; // 0..1
    y: number; // 0..1
    start: number;
    end: number;
    fontScale: number; // fraction of height
    color: string;
    rotation: number;
    bold: boolean;
    opacity: number;
  },
  width: number,
  height: number
): string {
  const px = Math.round(opts.x * width);
  const py = Math.round(opts.y * height);
  const fs = Math.round(opts.fontScale * height);
  const color = assColor(opts.color);
  const alpha = `\\alpha${pad2hex(Math.round((1 - opts.opacity) * 255))}&`;
  const rot = opts.rotation ? `\\frz${(-opts.rotation).toFixed(1)}` : "";
  const bold = opts.bold ? "\\b1" : "";
  const tag = `{\\an5\\pos(${px},${py})\\fs${fs}\\1c${color}${alpha}${rot}${bold}}`;
  // Mirror the preview's wrapping: text is capped at 90% of the frame width and
  // wraps (breaking long words) instead of running past the border.
  const maxChars = Math.max(1, Math.floor((width * 0.9) / (fs * 0.55)));
  const wrapped = text
    .split("\n")
    .flatMap((line) => wrapLine(line, maxChars))
    .join("\n");
  return `Dialogue: 1,${formatAssTime(opts.start)},${formatAssTime(opts.end)},Default,,0,0,0,,${tag}${escapeAss(wrapped)}`;
}

/**
 * The clip's title as a single ASS dialogue line: bold white text centered
 * horizontally, sitting just above the top edge of the contain-fitted video so
 * it lands on the blurred fill rather than over the footage. `videoTopFrac` is
 * the video band's top edge as a fraction of the frame height ((1 - videoH/frameH)/2);
 * pass 0 for a source that fills the frame — the title then clamps to a safe
 * band near the top instead of disappearing. Shown for the whole clip unless
 * `fadeMs` is given, which fades the line in and back out at its own edges —
 * what the long-form opening uses for a title card that clears the frame.
 */
export function buildClipTitleDialogue(
  title: string,
  width: number,
  height: number,
  start: number,
  end: number,
  videoTopFrac: number,
  fadeMs?: { in: number; out: number }
): string {
  const fs = Math.max(12, Math.round(height * 0.034));
  const gap = Math.round(height * 0.018);
  // \an2 anchors the text block's bottom-center at pos, so a wrapped title
  // grows upward into the blur instead of down over the video.
  const y = Math.max(Math.round(height * 0.1), Math.round(clamp01(videoTopFrac) * height) - gap);
  const maxChars = Math.max(1, Math.floor((width * 0.88) / (fs * 0.52)));
  const wrapped = wrapLine(title, maxChars).join("\n");
  const fade = fadeMs ? `\\fad(${Math.max(0, Math.round(fadeMs.in))},${Math.max(0, Math.round(fadeMs.out))})` : "";
  const tag = `{\\an2\\pos(${Math.round(width / 2)},${y})${fade}}`;
  return `Dialogue: 3,${formatAssTime(start)},${formatAssTime(end)},Title,,0,0,0,,${tag}${escapeAss(wrapped)}`;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** Greedy word-wrap; words longer than maxChars are hard-broken. */
function wrapLine(line: string, maxChars: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of line.split(/\s+/).filter(Boolean)) {
    for (let i = 0; i < word.length; i += maxChars) {
      const chunk = word.slice(i, i + maxChars);
      if (!current) current = chunk;
      else if (current.length + 1 + chunk.length <= maxChars) current += ` ${chunk}`;
      else {
        out.push(current);
        current = chunk;
      }
    }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}

/** Brand colors for the CoLateral watermark. */
const COLATERAL_PURPLE = "#a855f7";

/**
 * A left-aligned CoLateral watermark lockup — a purple rounded badge next to the
 * "CoLateral AI" wordmark — burned for the whole clip. Emitted as two
 * separately positioned ASS lines (badge \an1, wordmark \an4 vertically centered
 * on the badge) so layout stays exact regardless of font metrics. `position`
 * pins the lockup to the top-left or bottom-left corner (default bottom).
 */
export function buildWatermarkDialogue(
  height: number,
  start: number,
  end: number,
  position: "top" | "bottom" = "bottom"
): string {
  const pad = Math.round(height * 0.035);
  const fs = Math.max(10, Math.round(height * 0.03));
  const b = Math.round(fs * 1.15); // badge side
  const gap = Math.round(fs * 0.4);
  const r = Math.max(2, Math.round(b * 0.28)); // corner radius
  // \an1 anchors the badge's bottom-left at `baseY`; the path rises b px above
  // it. Top placement sits the badge b px below the pad; bottom hugs the floor.
  const baseY = position === "top" ? pad + b : height - pad; // bottom of the badge
  const midY = baseY - Math.round(b / 2); // vertical center of the badge
  // Rounded square spanning x:[0,b], y:[-b,0]; with \an1 its bottom-left sits at pos.
  const path =
    `m ${r} ${-b} l ${b - r} ${-b} b ${b} ${-b} ${b} ${-b} ${b} ${-b + r} ` +
    `l ${b} ${-r} b ${b} 0 ${b} 0 ${b - r} 0 ` +
    `l ${r} 0 b 0 0 0 0 0 ${-r} ` +
    `l 0 ${-b + r} b 0 ${-b} 0 ${-b} ${r} ${-b}`;
  const purple = assColor(COLATERAL_PURPLE);
  // \alpha keeps the lockup subtle; the Watermark style carries the outline/shadow.
  const badge =
    `Dialogue: 2,${formatAssTime(start)},${formatAssTime(end)},Watermark,,0,0,0,,` +
    `{\\an1\\pos(${pad},${baseY})\\bord0\\shad0\\alpha&H22&\\1c${purple}\\p1}${path}`;
  const wordmark =
    `Dialogue: 2,${formatAssTime(start)},${formatAssTime(end)},Watermark,,0,0,0,,` +
    `{\\an4\\pos(${pad + b + gap},${midY})\\alpha&H22&\\fs${fs}}CoLateral AI`;
  return `${badge}\n${wordmark}`;
}

// --- Style presets ---------------------------------------------------------

export const CAPTION_FONT_FAMILIES = [
  "Montserrat Black",
  "Montserrat ExtraBold",
  "Poppins Black",
  "Poppins ExtraBold",
  "Anton",
  "Archivo Black",
  "Instrument Serif"
] as const;

export function isBundledCaptionFont(fontFamily: string): boolean {
  const first = fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
  return (CAPTION_FONT_FAMILIES as readonly string[]).includes(first);
}

export const DEFAULT_GENERATOR_CAPTION_PRESET: CaptionPresetId = "pop";

export const GENERATOR_CAPTION_PRESETS: CaptionPresetId[] = [
  "pop",
  "impact",
  "hype",
  "punch",
  "glow",
  "neon",
  "boxed",
  "sweep",
  "editorial",
  "paper",
  "subtle",
  "colateral-purple"
];

export function isCaptionPresetId(value: unknown): value is CaptionPresetId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CAPTION_PRESETS, value);
}

type CaptionPresetLook = Omit<Partial<CaptionStyle>, "offsetX" | "offsetY">;

function look(style: CaptionPresetLook): CaptionPresetLook {
  return {
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    alignment: "center",
    position: "lower-third",
    italic: false,
    glowColor: undefined,
    ...style
  };
}

export const CAPTION_PRESETS: Record<
  CaptionPresetId,
  { label: string; description?: string; sample?: [string, string, string]; style: Partial<CaptionStyle> }
> = {
  pop: {
    label: "Pop",
    description: "Heavy white type, yellow spoken word, springy pop-in",
    sample: ["this", "changed", "everything"],
    style: look({
      fontFamily: "Montserrat Black, Inter, sans-serif",
      fontWeight: 900,
      fontScale: 0.046,
      textColor: "#ffffff",
      highlightColor: "#ffe234",
      outlineWidth: 6,
      shadow: 3,
      animation: "pop",
      maxWordsPerCaption: 3,
      wordsPerLine: 3,
      uppercase: true
    })
  },
  impact: {
    label: "Impact",
    description: "Tall condensed type, two words at a time",
    sample: ["ten", "million", "views"],
    style: look({
      fontFamily: "Anton, Impact, sans-serif",
      fontWeight: 400,
      fontScale: 0.065,
      textColor: "#ffffff",
      highlightColor: "#ffd60a",
      outlineWidth: 7,
      shadow: 5,
      animation: "pop",
      maxWordsPerCaption: 2,
      wordsPerLine: 2,
      uppercase: true
    })
  },
  hype: {
    label: "Hype",
    description: "Extra-heavy stroke, hard shadow, electric green word",
    sample: ["we", "are", "so back"],
    style: look({
      fontFamily: "Montserrat Black, Inter, sans-serif",
      fontWeight: 900,
      fontScale: 0.048,
      textColor: "#ffffff",
      highlightColor: "#39ff6a",
      outlineWidth: 8,
      shadow: 6,
      animation: "pop",
      maxWordsPerCaption: 3,
      wordsPerLine: 3,
      uppercase: true
    })
  },
  punch: {
    label: "Punch",
    description: "One oversized word at a time, for fast hooks",
    sample: ["never", "sell", "early"],
    style: look({
      fontFamily: "Anton, Impact, sans-serif",
      fontWeight: 400,
      fontScale: 0.078,
      textColor: "#ffffff",
      highlightColor: "#ffffff",
      outlineWidth: 8,
      shadow: 6,
      position: "middle",
      animation: "pop",
      maxWordsPerCaption: 1,
      wordsPerLine: 1,
      uppercase: true
    })
  },
  glow: {
    label: "Glow",
    description: "Clean white type with a cyan bloom",
    sample: ["level", "up", "fast"],
    style: look({
      fontFamily: "Montserrat ExtraBold, Inter, sans-serif",
      fontWeight: 800,
      fontScale: 0.042,
      textColor: "#ffffff",
      highlightColor: "#7df9ff",
      outlineWidth: 0,
      shadow: 2,
      animation: "pop",
      maxWordsPerCaption: 3,
      wordsPerLine: 3,
      uppercase: true,
      glowColor: "#00c8ff"
    })
  },
  neon: {
    label: "Neon",
    description: "Magenta bloom and a pink spoken word",
    sample: ["late", "night", "vibes"],
    style: look({
      fontFamily: "Poppins ExtraBold, Inter, sans-serif",
      fontWeight: 800,
      fontScale: 0.041,
      textColor: "#ffffff",
      highlightColor: "#ff9ceb",
      outlineWidth: 0,
      shadow: 2,
      animation: "pop",
      maxWordsPerCaption: 3,
      wordsPerLine: 3,
      uppercase: true,
      glowColor: "#ff2ec4"
    })
  },
  boxed: {
    label: "Boxed",
    description: "Translucent plate behind the line, readable on anything",
    sample: ["read", "this", "first"],
    style: look({
      fontFamily: "Archivo Black, Inter, sans-serif",
      fontWeight: 400,
      fontScale: 0.037,
      textColor: "#ffffff",
      highlightColor: "#ffd23f",
      backgroundOpacity: 0.62,
      outlineWidth: 0,
      shadow: 0,
      animation: "fade",
      maxWordsPerCaption: 3,
      wordsPerLine: 3,
      uppercase: true
    })
  },
  sweep: {
    label: "Sweep",
    description: "Colour sweeps through each word as it is spoken",
    sample: ["watch", "this", "part"],
    style: look({
      fontFamily: "Poppins ExtraBold, Inter, sans-serif",
      fontWeight: 800,
      fontScale: 0.04,
      textColor: "#ffffff",
      highlightColor: "#ff5fa2",
      outlineWidth: 5,
      shadow: 2,
      animation: "karaoke",
      maxWordsPerCaption: 4,
      wordsPerLine: 4,
      uppercase: true
    })
  },
  editorial: {
    label: "Editorial",
    description: "Italic serif in sentence case, for stories and podcasts",
    sample: ["and", "then", "everything"],
    style: look({
      fontFamily: "Instrument Serif, Georgia, serif",
      fontWeight: 400,
      fontScale: 0.058,
      textColor: "#ffffff",
      highlightColor: "#ffe6b8",
      outlineWidth: 0,
      shadow: 3,
      animation: "karaoke",
      maxWordsPerCaption: 4,
      wordsPerLine: 4,
      uppercase: false,
      italic: true
    })
  },
  paper: {
    label: "Paper",
    description: "Dark type on a white card, clean and educational",
    sample: ["here is", "the", "lesson"],
    style: look({
      fontFamily: "Poppins ExtraBold, Inter, sans-serif",
      fontWeight: 800,
      fontScale: 0.035,
      textColor: "#111111",
      highlightColor: "#6d28d9",
      backgroundColor: "#ffffff",
      backgroundOpacity: 0.94,
      outlineWidth: 0,
      shadow: 0,
      animation: "none",
      maxWordsPerCaption: 4,
      wordsPerLine: 4,
      uppercase: false
    })
  },
  subtle: {
    label: "Subtle",
    description: "Light sentence case, no stroke, for interviews and vlogs",
    sample: ["honestly", "it", "worked"],
    style: look({
      fontFamily: "Montserrat ExtraBold, Inter, sans-serif",
      fontWeight: 800,
      fontScale: 0.036,
      textColor: "#ffffff",
      highlightColor: "#c4f1ff",
      outlineWidth: 0,
      shadow: 2,
      animation: "karaoke",
      maxWordsPerCaption: 4,
      wordsPerLine: 4,
      uppercase: false
    })
  },
  minimal: {
    label: "Minimal",
    style: {
      fontWeight: 600,
      fontScale: 0.045,
      textColor: "#ffffff",
      backgroundColor: "#000000",
      backgroundOpacity: 0,
      outlineWidth: 1.5,
      shadow: 1,
      position: "bottom",
      animation: "fade",
      uppercase: false
    }
  },
  "bold-shorts": {
    label: "Bold Shorts",
    style: {
      fontWeight: 900,
      fontScale: 0.072,
      textColor: "#ffffff",
      highlightColor: "#ffd34d",
      backgroundColor: "#000000",
      backgroundOpacity: 0,
      outlineWidth: 4,
      shadow: 2,
      position: "middle",
      animation: "pop",
      maxWordsPerCaption: 4,
      wordsPerLine: 2,
      uppercase: true
    }
  },
  "highlight-word": {
    label: "Highlight Current Word",
    style: {
      fontWeight: 800,
      fontScale: 0.066,
      textColor: "#ffffff",
      highlightColor: "#39e08b",
      backgroundColor: "#000000",
      backgroundOpacity: 0,
      outlineWidth: 3,
      shadow: 2,
      position: "middle",
      animation: "karaoke",
      maxWordsPerCaption: 5,
      uppercase: false
    }
  },
  "lower-third": {
    label: "Lower Third",
    style: {
      fontWeight: 700,
      fontScale: 0.05,
      textColor: "#ffffff",
      highlightColor: "#7c5cff",
      backgroundColor: "#101018",
      backgroundOpacity: 0.7,
      outlineWidth: 0,
      shadow: 1,
      position: "lower-third",
      alignment: "left",
      animation: "fade",
      uppercase: false
    }
  },
  "colateral-purple": {
    label: "CoLateral Purple",
    style: {
      fontWeight: 800,
      fontScale: 0.062,
      textColor: "#ffffff",
      highlightColor: "#a585ff",
      backgroundColor: "#2a1a5e",
      backgroundOpacity: 0,
      outlineWidth: 3,
      shadow: 2,
      position: "bottom",
      alignment: "center",
      animation: "fade",
      maxWordsPerCaption: 6,
      uppercase: false
    }
  }
};
