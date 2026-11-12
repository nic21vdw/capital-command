import { z } from "zod";
import type { ClipProject } from "@/types/domain";

const color = z.string().regex(/^#[\da-f]{6}$/i, "Use a six-digit hex colour.");

// A look carries presentation only. Source-specific placement, caption text,
// timing, crop, audio and export destinations never become brand defaults.
export const videoLookStyleSchema = z.object({
  fontFamily: z.string().trim().min(1).max(120),
  fontScale: z.number().min(0.02).max(0.2),
  fontWeight: z.number().int().min(100).max(900),
  textColor: color,
  highlightColor: color,
  backgroundColor: color,
  backgroundOpacity: z.number().min(0).max(1),
  outlineWidth: z.number().min(0).max(10),
  shadow: z.number().min(0).max(10),
  position: z.enum(["top", "middle", "bottom", "lower-third"]),
  alignment: z.enum(["left", "center", "right"]),
  maxWordsPerCaption: z.number().int().min(1).max(40),
  wordsPerLine: z.number().int().min(1).max(20),
  animation: z.enum(["none", "fade", "pop", "karaoke"]),
  uppercase: z.boolean(),
  italic: z.boolean().optional(),
  glowColor: color.optional()
});

export const videoLookSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
  name: z.string().trim().min(1).max(60),
  guidance: z.string().trim().max(1200),
  captionStyle: videoLookStyleSchema,
  captionsVisible: z.boolean(),
  highlightCurrentWord: z.boolean(),
  burnCaptions: z.boolean()
});

export type VideoLook = z.infer<typeof videoLookSchema>;

export function captureVideoLook(project: ClipProject, id: string, name: string, guidance: string): VideoLook {
  return videoLookSchema.parse({
    id, name, guidance,
    captionStyle: project.captionStyle,
    captionsVisible: project.captionsVisible,
    highlightCurrentWord: project.highlightCurrentWord,
    burnCaptions: project.exportSettings.burnCaptions
  });
}

export function videoLookPatch(project: ClipProject, look: VideoLook): Partial<ClipProject> {
  const checked = videoLookSchema.parse(look);
  return {
    captionStyle: {
      ...checked.captionStyle,
      // Keep the placement chosen for this particular shot.
      offsetX: project.captionStyle.offsetX,
      offsetY: project.captionStyle.offsetY
    },
    captionsVisible: checked.captionsVisible,
    highlightCurrentWord: checked.highlightCurrentWord,
    exportSettings: { ...project.exportSettings, burnCaptions: checked.burnCaptions }
  };
}

export function videoLookBrief(look: VideoLook): string {
  const s = look.captionStyle;
  return [
    `Video look: ${look.name}`,
    `Captions: ${look.captionsVisible ? "visible" : "hidden"}; ${s.fontFamily}; weight ${s.fontWeight}; ${Math.round(s.fontScale * 1000) / 10}% of frame height.`,
    `Text ${s.textColor}; highlight ${s.highlightColor}; ${s.position}; ${s.alignment}; ${s.animation} animation.`,
    `Active-word highlight: ${look.highlightCurrentWord ? "on" : "off"}. Burn captions on export: ${look.burnCaptions ? "on" : "off"}.`,
    "Apply presentation only. Preserve the edit's words, cuts, timing, framing, overlays and audio.",
    look.guidance ? `Editorial guidance (manual, not automatically applied): ${look.guidance}` : "",
    "This is an editing brief, not evidence of a rendered or published video."
  ].filter(Boolean).join("\n");
}
