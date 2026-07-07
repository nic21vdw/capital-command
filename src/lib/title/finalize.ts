import { decorateTitle, type DecorateResult } from "@/lib/title/emoji-decorator";
import { loadEmojiConfig, type EmojiConfig } from "@/lib/title/emoji-config";
import { logTitle, type TitlePipeline } from "@/lib/title/title-log";

// The single shared post-processing step for title generation. Both the
// long-form uploader and the short-form clip generator call finalizeTitle
// after producing their base title, so emoji handling and CTR logging behave
// identically across pipelines and there is exactly one place to change.

export type FinalizeTitleParams = {
  /** The plain title produced by the base generator (no emoji). */
  baseTitle: string;
  /** Content category/topic. Absent → treated as "default" (no emoji). */
  category?: string | null;
  pipelineType: TitlePipeline;
  /** Id recorded in the log (queue item id / export id). */
  videoId: string;
  /** Override the loaded config (tests, per-call tweaks). */
  config?: EmojiConfig;
  /** Injectable RNG for deterministic selection in tests. */
  random?: () => number;
  /** Override the log path (tests). */
  logPath?: string;
};

export type FinalizeTitleResult = DecorateResult & {
  /** Alias of decoratedTitle — the value the caller should publish. */
  title: string;
};

/**
 * Decorates the base title with an optional category emoji and logs the
 * outcome (video id, title, pipeline, category, emoji_used, emoji_char,
 * timestamp). Logging never throws, so a title is always returned. When emoji
 * is disabled the returned title equals baseTitle exactly.
 */
export async function finalizeTitle(params: FinalizeTitleParams): Promise<FinalizeTitleResult> {
  const config = params.config ?? loadEmojiConfig();
  const category = params.category?.trim() || "default";
  const result = decorateTitle(params.baseTitle, params.category, config, { random: params.random });

  await logTitle(
    {
      videoId: params.videoId,
      title: result.decoratedTitle,
      pipelineType: params.pipelineType,
      category,
      emojiUsed: result.emojiUsed,
      emojiChar: result.emojiChar,
      timestamp: new Date().toISOString()
    },
    params.logPath
  );

  return { ...result, title: result.decoratedTitle };
}
