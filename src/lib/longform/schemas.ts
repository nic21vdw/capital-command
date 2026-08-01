import { z } from "zod";
import { captionSegmentSchema, captionStyleSchema, sfxSettingsSchema } from "@/lib/storage/schemas";

// Zod validation for the Long-Form Editor's API payloads. Only the fields the
// editor is allowed to change are accepted — pipeline state (status, stage,
// transcript, silences, exports) is server-owned.

export const longformSegmentSchema = z.object({
  id: z.string(),
  start: z.coerce.number().min(0),
  end: z.coerce.number().min(0),
  kind: z.enum(["speech", "silence"]),
  enabled: z.coerce.boolean()
});

export const longformHookSchema = z.object({
  enabled: z.coerce.boolean(),
  start: z.coerce.number().min(0).max(60).default(0),
  end: z.coerce.number().min(0).max(60),
  zoom: z.coerce.number().min(1).max(2.5),
  focusX: z.coerce.number().min(0).max(1),
  focusY: z.coerce.number().min(0).max(1),
  captionsEnabled: z.coerce.boolean(),
  highlightCurrentWord: z.coerce.boolean(),
  captions: z.array(captionSegmentSchema),
  captionStyle: captionStyleSchema
});

export const longformCaptionsSchema = z.object({
  enabled: z.coerce.boolean(),
  highlightCurrentWord: z.coerce.boolean(),
  segments: z.array(captionSegmentSchema).max(5000),
  style: captionStyleSchema
});

export const longformOverlaySchema = z.object({
  id: z.string(),
  fileName: z.string(),
  storedName: z.string(),
  mime: z.string(),
  start: z.coerce.number().min(0),
  end: z.coerce.number().min(0),
  x: z.coerce.number().min(0).max(1),
  y: z.coerce.number().min(0).max(1),
  width: z.coerce.number().min(0.02).max(1),
  opacity: z.coerce.number().min(0).max(1)
});

export const longformAudioClipSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  fileName: z.string(),
  start: z.coerce.number().min(0),
  duration: z.coerce.number().min(0.1),
  volume: z.coerce.number().min(0).max(1)
});

export const longformMusicSchema = z.object({
  enabled: z.coerce.boolean(),
  clips: z.array(longformAudioClipSchema).max(200).default([]),
  videoVolume: z.coerce.number().min(0).max(2).default(1),
  masterVolume: z.coerce.number().min(0).max(2).default(1),
  // Legacy fields kept optional so older saved projects still validate.
  trackId: z.string().optional(),
  volume: z.coerce.number().min(0).max(1).optional(),
  fadeOut: z.coerce.number().min(0).max(15).optional()
});

export const longformPaceSchema = z.object({
  minSilenceSec: z.coerce.number().min(0.2).max(5),
  paddingSec: z.coerce.number().min(0).max(1)
});

/** PATCH body for a project: any subset of the editable fields. */
export const longformProjectPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    // Editable posting copy shown in the editor's Description dropdown. Generous
    // caps so a full YouTube description and keyword list both fit.
    description: z.string().max(10000),
    keywords: z.string().max(2000),
    // Sized for stream VODs: an 8-hour recording on the Ultra pace produces
    // well over 10k segments, and the editor PATCHes the full list back.
    segments: z.array(longformSegmentSchema).max(50000),
    hook: longformHookSchema,
    captions: longformCaptionsSchema,
    overlays: z.array(longformOverlaySchema).max(100),
    music: longformMusicSchema,
    sfx: sfxSettingsSchema,
    layout: z.enum(["wide", "vertical"]),
    pace: longformPaceSchema
  })
  .partial();

/**
 * POST body for an export. With `topicId` the render is that one topic
 * segment of the recording; without it, the whole edit as before.
 */
export const longformExportSchema = z
  .object({
    topicId: z.string().min(1).max(64).optional()
  })
  .default({});

/** POST body for (re)planning the recording's topic segments. */
export const longformTopicPlanSchema = z
  .object({
    /** Pin the number of segments instead of letting the length decide. */
    count: z.coerce.number().int().min(2).max(20).optional(),
    /** How long each segment should aim to be. */
    targetMinutes: z.coerce.number().min(3).max(30).optional()
  })
  .default({});

// A project starts from either a previously uploaded `sourceId` or a video
// `url` (YouTube/VOD link) the server downloads itself. Exactly one is required.
export const longformCreateSchema = z
  .object({
    sourceId: z.string().min(1).optional(),
    url: z.string().trim().url().optional(),
    name: z.string().trim().max(200).optional()
  })
  .refine((data) => Boolean(data.sourceId) !== Boolean(data.url), {
    message: "Provide either a `sourceId` or a `url`, not both."
  });
