import { SHORT_MAX_SECONDS, type Outlier, type WatchlistChannel } from "@/lib/youtube/outliers";

/**
 * Competition analysis: pure aggregation across watchlist channels — by
 * default the whole watchlist, optionally narrowed to a labeled group —
 * answering "what is working for these channels as a group?": shared breakout
 * topics, packaging patterns, and format trends across their flagged outliers.
 *
 * Like buildOutlierInsights this module is pure (no I/O) so it runs the same
 * on the client (live panel) and the server (feeding the AI insights prompt),
 * and the heuristics are unit-testable.
 */

/** Suggested default label — free text, so any grouping ("Aspirational", "Niche") works too. */
export const DEFAULT_COMPETITION_GROUP = "Competition";

export const MAX_GROUP_LABEL_LENGTH = 60;

/** Trims/collapses whitespace and caps length; "" means unlabeled. */
export function normalizeGroupLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_GROUP_LABEL_LENGTH);
}

/** Distinct non-empty group labels, case-insensitively deduped, first-seen casing wins. */
export function channelGroupOptions(channels: WatchlistChannel[]): string[] {
  const seen = new Map<string, string>();
  for (const channel of channels) {
    const label = normalizeGroupLabel(channel.group);
    if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Channels to analyze: group null = the whole watchlist (labeling is never
 * required — one click works on everything); a group narrows the analysis to
 * channels carrying that label, e.g. to keep your own channel out of the
 * competition set.
 */
export function selectCompetitorChannels(channels: WatchlistChannel[], group: string | null): WatchlistChannel[] {
  if (group === null) return [...channels];
  const wanted = normalizeGroupLabel(group).toLowerCase();
  return channels.filter((channel) => normalizeGroupLabel(channel.group).toLowerCase() === wanted);
}

// ----- Report shapes -----

export type TrendExample = {
  videoId: string;
  title: string;
  channelTitle: string;
  multiplier: number;
  url: string;
};

/** A word/phrase recurring across the group's breakout titles. */
export type TrendTheme = {
  phrase: string;
  videoCount: number;
  channelCount: number;
  channels: string[];
  examples: TrendExample[];
};

/** A packaging pattern (question hook, number, money…) and how often it shows up. */
export type TitleSignalStat = {
  id: string;
  label: string;
  videoCount: number;
  channelCount: number;
  /** videoCount / total outliers in the group (0-1). */
  share: number;
};

export type CompetitorChannelSummary = {
  channelId: string;
  title: string;
  handle: string | null;
  group: string;
  baselineViews: number | null;
  outlierCount: number;
  topOutlier: TrendExample | null;
  lastFetchedAt: string | null;
};

export type CompetitorTrendReport = {
  group: string | null;
  generatedAt: string;
  channelCount: number;
  channelsWithOutliers: number;
  outlierCount: number;
  /** Outliers published in the last 90 days — how "current" the trend is. */
  recentOutlierCount: number;
  medianMultiplier: number | null;
  formatSplit: { shorts: number; long: number; unknown: number };
  themes: TrendTheme[];
  titleSignals: TitleSignalStat[];
  channels: CompetitorChannelSummary[];
  topOutliers: Array<TrendExample & { views: number; durationSeconds: number | null; publishedAt: string }>;
  /** Generated plain-language implications for the user's next video. */
  takeaways: string[];
  warnings: string[];
};

// ----- Internals -----

const RECENT_WINDOW_DAYS = 90;
const MAX_THEMES = 12;
const MAX_TOP_OUTLIERS = 10;

/** Common words that never make a topic; kept small and niche-agnostic. */
const STOPWORDS = new Set(
  (
    "a an and are as at be but by can could did do does for from get got has have how i if in into is it its just " +
    "me my new not now of on or our out so that the this to up us was we what when why will with you your yours " +
    "he she they them his her their there here over under about after before more most less very really actually"
  ).split(" ")
);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const compact = (value: number) =>
  Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);

function toExample(outlier: Outlier): TrendExample {
  return {
    videoId: outlier.videoId,
    title: outlier.title,
    channelTitle: outlier.channelTitle,
    multiplier: outlier.multiplier,
    url: outlier.url
  };
}

function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9$#\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** A token that could anchor a theme: not a stopword, not a bare number. */
function isThemeWord(token: string): boolean {
  return token.length >= 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token);
}

type PhraseHit = { videoIds: Set<string>; channelIds: Set<string> };

/**
 * Recurring unigrams + bigrams across the group's outlier titles. A phrase is
 * a trend when multiple channels break out with it (or, when only one channel
 * is selected, when it repeats across that channel's breakouts). Bigrams that
 * qualify suppress their component words when they cover the same videos, so
 * "vibe coding" doesn't also surface as "vibe" and "coding".
 */
function buildThemes(outliers: Outlier[], channelCount: number): TrendTheme[] {
  const hits = new Map<string, PhraseHit>();
  const record = (phrase: string, outlier: Outlier) => {
    const hit = hits.get(phrase) ?? { videoIds: new Set(), channelIds: new Set() };
    hit.videoIds.add(outlier.videoId);
    hit.channelIds.add(outlier.channelId);
    hits.set(phrase, hit);
  };

  for (const outlier of outliers) {
    const tokens = tokenize(outlier.title);
    const seenInTitle = new Set<string>();
    for (let i = 0; i < tokens.length; i += 1) {
      const word = tokens[i];
      if (isThemeWord(word) && !seenInTitle.has(word)) {
        seenInTitle.add(word);
        record(word, outlier);
      }
      const next = tokens[i + 1];
      if (next && isThemeWord(word) && isThemeWord(next)) {
        const bigram = `${word} ${next}`;
        if (!seenInTitle.has(bigram)) {
          seenInTitle.add(bigram);
          record(bigram, outlier);
        }
      }
    }
  }

  const qualifies = (hit: PhraseHit) => (channelCount >= 2 ? hit.channelIds.size >= 2 : hit.videoIds.size >= 2);
  const qualified = [...hits.entries()].filter(([, hit]) => qualifies(hit));

  const suppressed = new Set<string>();
  for (const [phrase, hit] of qualified) {
    if (!phrase.includes(" ")) continue;
    for (const word of phrase.split(" ")) {
      const wordHit = hits.get(word);
      if (wordHit && wordHit.videoIds.size === hit.videoIds.size) suppressed.add(word);
    }
  }

  const outliersById = new Map(outliers.map((o) => [o.videoId, o]));
  return qualified
    .filter(([phrase]) => !suppressed.has(phrase))
    .map(([phrase, hit]) => {
      const examples = [...hit.videoIds]
        .map((id) => outliersById.get(id))
        .filter((o): o is Outlier => Boolean(o))
        .sort((a, b) => b.multiplier - a.multiplier)
        .slice(0, 3)
        .map(toExample);
      const channels = [...new Set(examples.map((e) => e.channelTitle))];
      return { phrase, videoCount: hit.videoIds.size, channelCount: hit.channelIds.size, channels, examples };
    })
    .sort((a, b) => b.channelCount - a.channelCount || b.videoCount - a.videoCount || a.phrase.localeCompare(b.phrase))
    .slice(0, MAX_THEMES);
}

const TITLE_SIGNALS: Array<{ id: string; label: string; test: (title: string) => boolean }> = [
  { id: "question", label: "Question hook", test: (t) => t.includes("?") },
  { id: "how-to", label: "How-to promise", test: (t) => /\bhow\b/i.test(t) },
  { id: "number", label: "Concrete number", test: (t) => /\d/.test(t) },
  { id: "money", label: "Money amount", test: (t) => /[$€£]\s?\d|\b\d+k\b/i.test(t) },
  { id: "i-built", label: "“I built/made” story", test: (t) => /\bi (built|made|created|coded|launched)\b/i.test(t) },
  { id: "versus", label: "X vs Y comparison", test: (t) => /\bvs\.?\b/i.test(t) },
  { id: "time-boxed", label: "Time-boxed challenge", test: (t) => /\bin \d+\s?(seconds|minutes|hours|days|weeks)\b/i.test(t) },
  { id: "no-code", label: "No-code angle", test: (t) => /no.?code/i.test(t) }
];

function buildTitleSignals(outliers: Outlier[]): TitleSignalStat[] {
  if (outliers.length === 0) return [];
  return TITLE_SIGNALS.map(({ id, label, test }) => {
    const matched = outliers.filter((o) => test(o.title));
    return {
      id,
      label,
      videoCount: matched.length,
      channelCount: new Set(matched.map((o) => o.channelId)).size,
      share: matched.length / outliers.length
    };
  })
    .filter((signal) => signal.videoCount >= 2 || signal.share >= 0.5)
    .sort((a, b) => b.videoCount - a.videoCount);
}

// ----- The report -----

export function buildCompetitorTrendReport(
  channels: WatchlistChannel[],
  outliers: Outlier[],
  options: { group: string | null; now?: Date }
): CompetitorTrendReport {
  const now = options.now ?? new Date();
  const selected = selectCompetitorChannels(channels, options.group);
  const selectedIds = new Set(selected.map((channel) => channel.id));
  const groupOutliers = outliers.filter((outlier) => selectedIds.has(outlier.channelId));

  const channelSummaries: CompetitorChannelSummary[] = selected
    .map((channel) => {
      const own = groupOutliers
        .filter((outlier) => outlier.channelId === channel.id)
        .sort((a, b) => b.multiplier - a.multiplier);
      return {
        channelId: channel.id,
        title: channel.title,
        handle: channel.handle,
        group: normalizeGroupLabel(channel.group),
        baselineViews: channel.baseline?.medianViews ?? null,
        outlierCount: own.length,
        topOutlier: own[0] ? toExample(own[0]) : null,
        lastFetchedAt: channel.lastFetchedAt
      };
    })
    .sort((a, b) => b.outlierCount - a.outlierCount || a.title.localeCompare(b.title));

  const recentCutoff = now.getTime() - RECENT_WINDOW_DAYS * 86_400_000;
  const recentOutlierCount = groupOutliers.filter((o) => new Date(o.publishedAt).getTime() >= recentCutoff).length;

  const formatSplit = { shorts: 0, long: 0, unknown: 0 };
  for (const outlier of groupOutliers) {
    if (outlier.durationSeconds === null) formatSplit.unknown += 1;
    else if (outlier.durationSeconds <= SHORT_MAX_SECONDS) formatSplit.shorts += 1;
    else formatSplit.long += 1;
  }

  const themes = buildThemes(groupOutliers, selected.length);
  const titleSignals = buildTitleSignals(groupOutliers);
  const topOutliers = [...groupOutliers]
    .sort((a, b) => b.multiplier - a.multiplier)
    .slice(0, MAX_TOP_OUTLIERS)
    .map((outlier) => ({
      ...toExample(outlier),
      views: outlier.views,
      durationSeconds: outlier.durationSeconds,
      publishedAt: outlier.publishedAt
    }));

  const channelsWithOutliers = channelSummaries.filter((c) => c.outlierCount > 0).length;
  const medianMultiplier = median(groupOutliers.map((o) => o.multiplier));

  // -- Takeaways: plain-language implications for the user's next video --
  const takeaways: string[] = [];
  const warnings: string[] = [];

  if (selected.length > 0 && groupOutliers.length > 0) {
    if (channelsWithOutliers >= 2) {
      takeaways.push(
        `${channelsWithOutliers} of ${selected.length} tracked competitors have at least one breakout — the patterns below are cross-channel, not one channel's fluke.`
      );
    }

    const known = formatSplit.shorts + formatSplit.long;
    if (known >= 3) {
      if (formatSplit.shorts / known >= 0.6) {
        takeaways.push(
          `${formatSplit.shorts} of ${known} breakouts with a known length are Shorts — the Shorts feed is doing the heavy lifting in this space; make sure your next idea has a Shorts version.`
        );
      } else if (formatSplit.long / known >= 0.6) {
        takeaways.push(
          `${formatSplit.long} of ${known} breakouts with a known length are long-form — competitors are winning on watch time, so a fuller video likely beats a Short for your next upload.`
        );
      }
    }

    const topTheme = themes[0];
    if (topTheme && topTheme.channelCount >= 2) {
      takeaways.push(
        `“${topTheme.phrase}” shows up in ${topTheme.videoCount} breakout title${topTheme.videoCount === 1 ? "" : "s"} across ${topTheme.channelCount} channels — a topic the whole space is winning with right now; plan a video that hits it with your own angle.`
      );
    } else if (topTheme) {
      takeaways.push(
        `“${topTheme.phrase}” repeats across this group's breakouts (${topTheme.videoCount} videos) — worth testing on your own channel.`
      );
    }

    const topSignal = titleSignals[0];
    if (topSignal) {
      takeaways.push(
        `${Math.round(topSignal.share * 100)}% of the group's breakout titles use a ${topSignal.label.toLowerCase()} — copy the packaging pattern before reinventing it.`
      );
    }

    if (medianMultiplier !== null) {
      takeaways.push(
        `The median breakout runs at ${medianMultiplier.toFixed(1)}× its channel's baseline — that's the bar a genuinely resonant topic clears in this niche.`
      );
    }

    if (recentOutlierCount === 0) {
      warnings.push(
        `None of the group's breakouts were published in the last ${RECENT_WINDOW_DAYS} days — these trends may be aging; run a stats pull and consider what's changed since.`
      );
    } else {
      takeaways.push(
        `${recentOutlierCount} of ${groupOutliers.length} breakouts were published in the last ${RECENT_WINDOW_DAYS} days — ${
          recentOutlierCount / groupOutliers.length >= 0.5 ? "the space is hot right now" : "the rest are older wins that may not repeat"
        }.`
      );
    }
  }

  const neverFetched = selected.filter((channel) => !channel.lastFetchedAt);
  if (neverFetched.length > 0) {
    warnings.push(
      `${neverFetched.length} labeled channel${neverFetched.length === 1 ? " has" : "s have"} never been scanned — run a stats pull so the analysis covers the whole group.`
    );
  }
  const staleCutoff = now.getTime() - 7 * 86_400_000;
  const stale = selected.filter(
    (channel) => channel.lastFetchedAt && new Date(channel.lastFetchedAt).getTime() < staleCutoff
  );
  if (stale.length > 0) {
    warnings.push(`Stats for ${stale.length} channel${stale.length === 1 ? "" : "s"} are over a week old — refresh before acting on the numbers.`);
  }

  return {
    group: options.group === null ? null : normalizeGroupLabel(options.group),
    generatedAt: now.toISOString(),
    channelCount: selected.length,
    channelsWithOutliers,
    outlierCount: groupOutliers.length,
    recentOutlierCount,
    medianMultiplier,
    formatSplit,
    themes,
    titleSignals,
    channels: channelSummaries,
    topOutliers,
    takeaways,
    warnings
  };
}

/** Compact human-readable serialization of the report for the AI prompt. */
export function describeReportForPrompt(report: CompetitorTrendReport): string {
  const lines: string[] = [];
  lines.push(
    `Group: ${report.group ?? "entire watchlist"} — ${report.channelCount} channels, ${report.outlierCount} breakout videos (${report.recentOutlierCount} published in the last ${RECENT_WINDOW_DAYS} days).`
  );
  if (report.medianMultiplier !== null) lines.push(`Median breakout multiplier: ${report.medianMultiplier.toFixed(1)}× channel baseline.`);
  lines.push(`Format split: ${report.formatSplit.shorts} Shorts / ${report.formatSplit.long} long-form / ${report.formatSplit.unknown} unknown length.`);

  lines.push("", "Channels:");
  for (const channel of report.channels) {
    lines.push(
      `- ${channel.title}${channel.handle ? ` (${channel.handle})` : ""}: baseline ${
        channel.baselineViews !== null ? `${compact(channel.baselineViews)} median views` : "unknown"
      }, ${channel.outlierCount} breakout${channel.outlierCount === 1 ? "" : "s"}${
        channel.topOutlier ? `, top: "${channel.topOutlier.title}" at ${channel.topOutlier.multiplier.toFixed(1)}×` : ""
      }`
    );
  }

  if (report.themes.length > 0) {
    lines.push("", "Recurring title themes across breakouts:");
    for (const theme of report.themes) {
      lines.push(`- "${theme.phrase}": ${theme.videoCount} videos across ${theme.channelCount} channel${theme.channelCount === 1 ? "" : "s"}`);
    }
  }
  if (report.titleSignals.length > 0) {
    lines.push("", "Packaging patterns in breakout titles:");
    for (const signal of report.titleSignals) {
      lines.push(`- ${signal.label}: ${signal.videoCount} videos (${Math.round(signal.share * 100)}%)`);
    }
  }
  if (report.topOutliers.length > 0) {
    lines.push("", "Top breakout videos (by multiplier over channel baseline):");
    for (const video of report.topOutliers) {
      lines.push(
        `- "${video.title}" — ${video.channelTitle}, ${video.multiplier.toFixed(1)}× (${compact(video.views)} views, ${
          video.durationSeconds !== null ? `${video.durationSeconds}s` : "length unknown"
        }, published ${video.publishedAt.slice(0, 10)})`
      );
    }
  }
  return lines.join("\n");
}
