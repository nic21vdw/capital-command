const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "my",
  "your",
  "is",
  "are",
  "with",
  "how",
  "what",
  "why",
  "i",
  "we",
  "you",
  "this",
  "that",
  "from",
  "at",
  "it",
  "its"
]);

/** The most meaningful 1-3 words from a title, used to seed overlay copy. */
export function keyPhrase(title: string): string {
  const words = title
    .replace(/[^\w\s'-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const significant = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  const picked = (significant.length > 0 ? significant : words).slice(0, 3);
  return picked.join(" ");
}

/**
 * Short on-thumbnail copy ideas derived from the actual title — punchy but
 * honest. These are starting points, not fabricated claims.
 */
export function overlayIdeas(title: string): string[] {
  const trimmed = title.trim();
  if (!trimmed) return [];
  const key = keyPhrase(trimmed);
  const keyUpper = key.toUpperCase();

  const ideas = [
    keyUpper,
    `${keyUpper}, EXPLAINED`,
    `THE TRUTH ABOUT ${keyUpper}`,
    `WHAT I LEARNED: ${keyUpper}`,
    `${keyUpper} — START HERE`,
    `BEFORE YOU TRY ${keyUpper}`
  ];

  // Keep only ideas short enough to read as 1-3 thumbnail lines.
  const unique = [...new Set(ideas)].filter((idea) => idea.length >= 3 && idea.length <= 44);
  return unique.slice(0, 5);
}

/** Title framing treatments for the video itself (not the thumbnail). */
export function titleTreatments(title: string): string[] {
  const trimmed = title.trim();
  if (!trimmed) return [];
  const key = keyPhrase(trimmed);
  const sentence = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  const treatments = [
    sentence,
    `${sentence} (What Actually Works)`,
    `${key}: A Practical Walkthrough`,
    `I Tried ${key} — Here's My Honest Take`
  ];
  return [...new Set(treatments)].filter((t) => t.length <= 100).slice(0, 4);
}
