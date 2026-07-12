"use client";

import { memo, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Crop,
  Download,
  FolderDown,
  Image as ImageIcon,
  Loader2,
  Lock,
  Merge,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Square,
  Trash2,
  Type,
  Unlock
} from "lucide-react";
import { CAPTION_PRESETS } from "@/lib/clipping/captions";
import {
  ASPECT_LABELS,
  EXPORT_PRESETS,
  applyCaptionPreset,
  aspectDimensions,
  formatClock,
  generateClipDescription,
  generateClipHashtags,
  generateClipTitleCandidates
} from "@/lib/clipping/editor";
import { CLIP_LAYOUTS, DEFAULT_FACE_SOURCE, DEFAULT_SCREEN_SOURCE, LAYOUT_MODE_PRESETS } from "@/lib/clipping/layouts";
import { useAppData } from "@/components/providers/app-provider";
import { Button } from "@/components/ui/button";
import { ColorField, Field, NumberField, RangeField, SelectField, Toggle } from "@/components/editor/controls";
import { SfxSection } from "@/components/editor/sfx-section";
import { cn, safeFilename } from "@/lib/utils";
import type { AspectRatioId, CaptionPresetId, ClipCompositionMode, ExportPresetId, OverlayKind } from "@/types/domain";
import type { EditorApi } from "@/components/editor/types";

/** Short-form layout presets. `vertical` presets only make sense at 9:16 and
 *  switch the project there when picked. */
const LAYOUT_PRESETS: Array<{ id: ClipCompositionMode; label: string; detail: string; vertical?: boolean }> = [
  { id: "stacked-split", label: "Screen + face", detail: "Full screen on top, face camera below.", vertical: true },
  { id: "stacked-split-flip", label: "Face + screen", detail: "Face camera on top, full screen below.", vertical: true },
  { id: "screen-lead", label: "Screen lead", detail: "Screen leads, small face inset underneath.", vertical: true },
  { id: "face-lead", label: "Face lead", detail: "Face leads, screen kept as a context banner.", vertical: true },
  { id: "center-blur", label: "Centered + blur", detail: "Clip centered over a blurred, zoomed copy of itself." },
  { id: "crop-fill", label: "Crop to fill", detail: "Fill the frame — zoom and pan to the main content." },
  { id: "fit", label: "Fullscreen", detail: "The whole source frame, letterboxed." }
];

/** Quick face-camera positions for the split layouts (normalized source rects). */
const FACE_CROP_PRESETS: Array<{ id: string; label: string; rect: { x: number; y: number; w: number; h: number } }> = [
  { id: "top-right", label: "Top right", rect: { x: 0.58, y: 0.05, w: 0.42, h: 0.5 } },
  { id: "top-left", label: "Top left", rect: { x: 0, y: 0.05, w: 0.42, h: 0.5 } },
  { id: "bottom-right", label: "Bottom right", rect: { x: 0.58, y: 0.45, w: 0.42, h: 0.5 } },
  { id: "bottom-left", label: "Bottom left", rect: { x: 0, y: 0.45, w: 0.42, h: 0.5 } },
  { id: "center", label: "Center", rect: { x: 0.25, y: 0.15, w: 0.5, h: 0.7 } }
];

/** Like Field, but for groups of buttons — a <label> wrapper would forward
 *  clicks on the caption to the first button and break accessible names. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-[var(--muted-foreground)]">{label}</p>
      {children}
    </div>
  );
}

/** Tiny 9:16 diagram of what each layout does. */
function LayoutThumb({ id }: { id: ClipCompositionMode }) {
  return (
    <span className="relative block h-14 w-8 shrink-0 overflow-hidden rounded border border-white/15 bg-black/60">
      {id === "stacked-split" && (
        <>
          <span className="absolute inset-x-0 top-[6%] h-[42%] bg-white/25" />
          <span className="absolute inset-x-0 top-[52%] h-[42%] bg-[var(--accent)]/70" />
        </>
      )}
      {id === "stacked-split-flip" && (
        <>
          <span className="absolute inset-x-0 top-[6%] h-[42%] bg-[var(--accent)]/70" />
          <span className="absolute inset-x-0 top-[52%] h-[42%] bg-white/25" />
        </>
      )}
      {id === "screen-lead" && (
        <>
          <span className="absolute inset-x-0 top-[12%] h-[44%] bg-white/25" />
          <span className="absolute right-[8%] top-[60%] h-[24%] w-[38%] bg-[var(--accent)]/70" />
        </>
      )}
      {id === "face-lead" && (
        <>
          <span className="absolute inset-x-[5%] top-[6%] h-[26%] bg-white/25" />
          <span className="absolute inset-x-0 top-[36%] h-[56%] bg-[var(--accent)]/70" />
        </>
      )}
      {id === "center-blur" && (
        <>
          <span className="absolute inset-0 bg-white/10" />
          <span className="absolute inset-x-0 top-1/2 h-[34%] -translate-y-1/2 bg-white/35" />
        </>
      )}
      {id === "crop-fill" && <span className="absolute inset-0 bg-white/35" />}
      {id === "fit" && <span className="absolute inset-x-0 top-1/2 h-[30%] -translate-y-1/2 bg-white/35" />}
    </span>
  );
}

// --- Captions panel --------------------------------------------------------

// All panels are memoized: the editor re-renders ~11 times a second while the
// preview plays (the playhead ticks), and the panels — which never show the
// playhead — would otherwise re-render their whole form tree each tick.
export const CaptionsPanel = memo(function CaptionsPanel({ api }: { api: EditorApi }) {
  const { project } = api;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={api.regenerateCaptions} disabled={api.fetchingCaptions}>
          {api.fetchingCaptions ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Regenerate
        </Button>
        <Button variant="secondary" onClick={api.addCaption}>
          <Plus className="mr-2 h-4 w-4" />
          Add
        </Button>
        <Toggle label="Show captions" checked={project.captionsVisible} onChange={(v) => api.patch({ captionsVisible: v })} />
        <Toggle label="Highlight word" checked={project.highlightCurrentWord} onChange={(v) => api.patch({ highlightCurrentWord: v })} />
      </div>

      {project.captions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
          No captions yet. Click <strong>Regenerate</strong> to pull automatic captions from the source, or <strong>Add</strong> a
          segment manually.
        </p>
      ) : (
        <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
          {project.captions.map((c) => {
            const selected = api.selectedCaptionId === c.id;
            return (
              <div
                key={c.id}
                className={cn(
                  "rounded-lg border p-2.5 transition",
                  selected ? "border-[var(--accent)]/60 bg-[var(--accent)]/8" : "border-[var(--border)] bg-black/20"
                )}
                onClick={() => api.setSelectedCaptionId(c.id)}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => api.seek(c.start)}
                    className="font-mono text-[11px] text-[var(--accent)] hover:underline"
                  >
                    {formatClock(c.start)} → {formatClock(c.end)}
                  </button>
                  <div className="ml-auto flex items-center gap-1">
                    <IconBtn title={c.enabled ? "Disable" : "Enable"} onClick={() => api.toggleCaption(c.id)}>
                      <Check className={cn("h-3.5 w-3.5", !c.enabled && "opacity-30")} />
                    </IconBtn>
                    <IconBtn title="Split at playhead" onClick={() => api.splitCaption(c.id)}>
                      <Scissors className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn title="Merge with next" onClick={() => api.mergeCaptionWithNext(c.id)}>
                      <Merge className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn title="Delete" onClick={() => api.deleteCaption(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  </div>
                </div>
                <textarea
                  value={c.text}
                  onChange={(e) => api.updateCaption(c.id, { text: e.target.value })}
                  rows={2}
                  className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2 text-sm text-white outline-none focus:border-[var(--accent)]"
                />
                {selected && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <NumberField label="Start" value={Number(c.start.toFixed(2))} step={0.05} min={0} onChange={(v) => api.updateCaption(c.id, { start: v })} />
                    <NumberField label="End" value={Number(c.end.toFixed(2))} step={0.05} min={0} onChange={(v) => api.updateCaption(c.id, { end: v })} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// --- Style panel -----------------------------------------------------------

export const StylePanel = memo(function StylePanel({ api }: { api: EditorApi }) {
  const s = api.project.captionStyle;
  const set = (partial: Partial<typeof s>) => api.patch({ captionStyle: { ...s, ...partial } });

  return (
    <div className="space-y-4">
      <Group label="Presets">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CAPTION_PRESETS) as CaptionPresetId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => api.patch({ captionStyle: applyCaptionPreset(s, id) })}
              className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-white"
            >
              {CAPTION_PRESETS[id].label}
            </button>
          ))}
        </div>
      </Group>

      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Font"
          value={s.fontFamily}
          onChange={(v) => set({ fontFamily: v })}
          options={[
            { value: "Inter, system-ui, sans-serif", label: "Inter" },
            { value: "Arial, sans-serif", label: "Arial" },
            { value: "Georgia, serif", label: "Georgia" },
            { value: "'Courier New', monospace", label: "Mono" },
            { value: "Impact, sans-serif", label: "Impact" }
          ]}
        />
        <SelectField
          label="Weight"
          value={String(s.fontWeight)}
          onChange={(v) => set({ fontWeight: Number(v) })}
          options={[
            { value: "400", label: "Regular" },
            { value: "600", label: "Semibold" },
            { value: "800", label: "Bold" },
            { value: "900", label: "Black" }
          ]}
        />
      </div>

      <RangeField label="Font size" value={s.fontScale} min={0.03} max={0.12} step={0.002} onChange={(v) => set({ fontScale: v })} format={(v) => `${Math.round(v * 100)}% h`} />

      <div className="grid grid-cols-2 gap-3">
        <ColorField label="Text colour" value={s.textColor} onChange={(v) => set({ textColor: v })} />
        <ColorField label="Highlight colour" value={s.highlightColor} onChange={(v) => set({ highlightColor: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ColorField label="Background" value={s.backgroundColor} onChange={(v) => set({ backgroundColor: v })} />
        <RangeField label="Background opacity" value={s.backgroundOpacity} min={0} max={1} step={0.05} onChange={(v) => set({ backgroundOpacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <RangeField label="Outline" value={s.outlineWidth} min={0} max={8} step={0.5} onChange={(v) => set({ outlineWidth: v })} />
        <RangeField label="Shadow" value={s.shadow} min={0} max={8} step={0.5} onChange={(v) => set({ shadow: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Position"
          value={s.position}
          // Picking a preset slot discards any drag-placed position.
          onChange={(v) => set({ position: v, offsetX: undefined, offsetY: undefined })}
          options={[
            { value: "top", label: "Top" },
            { value: "middle", label: "Middle" },
            { value: "bottom", label: "Bottom" },
            { value: "lower-third", label: "Lower third" }
          ]}
        />
        <SelectField
          label="Alignment"
          value={s.alignment}
          onChange={(v) => set({ alignment: v })}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Right" }
          ]}
        />
      </div>
      {s.offsetX !== undefined && s.offsetY !== undefined && (
        <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
          <span className="text-[var(--muted-foreground)]">
            Custom placement ({Math.round(s.offsetX * 100)}%, {Math.round(s.offsetY * 100)}%) — drag the caption on the
            preview to adjust.
          </span>
          <button
            type="button"
            className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 font-medium hover:bg-white/5"
            onClick={() => set({ offsetX: undefined, offsetY: undefined })}
          >
            Reset
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Max words / caption" value={s.maxWordsPerCaption} min={1} max={20} onChange={(v) => set({ maxWordsPerCaption: v })} />
        <NumberField label="Words / line" value={s.wordsPerLine} min={1} max={12} onChange={(v) => set({ wordsPerLine: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Animation"
          value={s.animation}
          onChange={(v) => set({ animation: v })}
          options={[
            { value: "none", label: "None" },
            { value: "fade", label: "Fade" },
            { value: "pop", label: "Pop" },
            { value: "karaoke", label: "Karaoke" }
          ]}
        />
        <div className="flex items-end">
          <Toggle label="UPPERCASE" checked={s.uppercase} onChange={(v) => set({ uppercase: v })} />
        </div>
      </div>
    </div>
  );
});

// --- Layout panel ------------------------------------------------------------

export const LayoutPanel = memo(function LayoutPanel({ api }: { api: EditorApi }) {
  const { project } = api;
  const r = project.reframe;
  const dims = aspectDimensions(project.aspectRatio);
  const aspectPreset: Record<Exclude<AspectRatioId, "custom">, ExportPresetId> = {
    "9:16": "shorts",
    "16:9": "longform",
    "1:1": "square",
    "4:5": "portrait"
  };
  const setAspect = (aspectRatio: Exclude<AspectRatioId, "custom">) => {
    const nextDims = aspectDimensions(aspectRatio);
    api.patch({
      aspectRatio,
      exportSettings: {
        ...project.exportSettings,
        preset: aspectPreset[aspectRatio],
        width: nextDims.w,
        height: nextDims.h
      }
    });
  };

  const pickLayout = (preset: (typeof LAYOUT_PRESETS)[number]) => {
    // Leaving the camera layouts also leaves crop adjustment mode.
    if (!LAYOUT_MODE_PRESETS[preset.id]) api.setCropEditing(null);
    // Stacked layouts are rendered at 1080x1920, so they force 9:16 output.
    if (preset.vertical && project.aspectRatio !== "9:16") {
      const nextDims = aspectDimensions("9:16");
      api.patch({
        compositionMode: preset.id,
        aspectRatio: "9:16",
        exportSettings: { ...project.exportSettings, preset: "shorts", width: nextDims.w, height: nextDims.h }
      });
    } else {
      api.patch({ compositionMode: preset.id });
    }
  };

  const showReframe = project.compositionMode === "center-blur" || project.compositionMode === "crop-fill";
  const activeLayout = LAYOUT_MODE_PRESETS[project.compositionMode];
  const hasFaceLayer = activeLayout ? CLIP_LAYOUTS[activeLayout].layers.some((l) => l.kind === "face") : false;
  const face = project.faceSource ?? DEFAULT_FACE_SOURCE;
  const screen = project.screenSource ?? DEFAULT_SCREEN_SOURCE;
  const clampSourceRect = (next: { x: number; y: number; w: number; h: number }) => ({
    x: Math.min(Math.max(0, next.x), 1 - Math.max(0.05, Math.min(next.w, 1))),
    y: Math.min(Math.max(0, next.y), 1 - Math.max(0.05, Math.min(next.h, 1))),
    w: Math.max(0.05, Math.min(next.w, 1)),
    h: Math.max(0.05, Math.min(next.h, 1))
  });
  const setFace = (partial: Partial<typeof face>) => {
    api.patch({ faceSource: clampSourceRect({ ...face, ...partial }) });
  };
  const setScreen = (partial: Partial<typeof screen>) => {
    api.patch({ screenSource: clampSourceRect({ ...screen, ...partial }) });
  };
  const faceMatches = (rect: typeof face) =>
    Math.abs(rect.x - face.x) < 0.01 && Math.abs(rect.y - face.y) < 0.01 && Math.abs(rect.w - face.w) < 0.01 && Math.abs(rect.h - face.h) < 0.01;
  const screenIsFullFrame =
    screen.x < 0.005 && screen.y < 0.005 && screen.w > 0.995 && screen.h > 0.995;

  return (
    <div className="space-y-4">
      <Group label="Layout">
        <div className="space-y-1.5">
          {LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => pickLayout(preset)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-200",
                project.compositionMode === preset.id
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--border-strong)] hover:text-white"
              )}
            >
              <LayoutThumb id={preset.id} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{preset.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{preset.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </Group>

      {activeLayout && (
        <Group label="Screen crop">
          <p className="text-xs text-[var(--muted-foreground)]">
            Which part of the source the screen panel shows. Shrink it to cut the camera out of the screen and zoom
            in on the content.
          </p>
          <div className="flex gap-1.5">
            <Button
              variant={api.cropEditing === "screen" ? "primary" : "secondary"}
              className="flex-1"
              onClick={() => api.setCropEditing(api.cropEditing === "screen" ? null : "screen")}
            >
              <Crop className="mr-2 h-4 w-4" />
              {api.cropEditing === "screen" ? "Done adjusting" : "Adjust on preview"}
            </Button>
            {!screenIsFullFrame && (
              <Button variant="ghost" onClick={() => api.patch({ screenSource: { ...DEFAULT_SCREEN_SOURCE } })}>
                Reset
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <RangeField label="Position X" value={screen.x} min={0} max={1} step={0.01} onChange={(v) => setScreen({ x: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <RangeField label="Position Y" value={screen.y} min={0} max={1} step={0.01} onChange={(v) => setScreen({ y: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <RangeField label="Width" value={screen.w} min={0.1} max={1} step={0.01} onChange={(v) => setScreen({ w: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <RangeField label="Height" value={screen.h} min={0.1} max={1} step={0.01} onChange={(v) => setScreen({ h: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </div>
        </Group>
      )}

      {hasFaceLayer && (
        <Group label="Face camera crop">
          <p className="text-xs text-[var(--muted-foreground)]">
            Point this at where the camera sits in the source — the layout crops it out and re-frames it.
          </p>
          <Button
            variant={api.cropEditing === "face" ? "primary" : "secondary"}
            className="w-full"
            onClick={() => api.setCropEditing(api.cropEditing === "face" ? null : "face")}
          >
            <Crop className="mr-2 h-4 w-4" />
            {api.cropEditing === "face" ? "Done adjusting" : "Adjust on preview"}
          </Button>
          <div className="flex flex-wrap gap-1.5">
            {FACE_CROP_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => api.patch({ faceSource: { ...preset.rect } })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition",
                  faceMatches(preset.rect)
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)] hover:text-white"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <RangeField label="Position X" value={face.x} min={0} max={1} step={0.01} onChange={(v) => setFace({ x: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <RangeField label="Position Y" value={face.y} min={0} max={1} step={0.01} onChange={(v) => setFace({ y: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <RangeField label="Width" value={face.w} min={0.1} max={1} step={0.01} onChange={(v) => setFace({ w: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <RangeField label="Height" value={face.h} min={0.1} max={1} step={0.01} onChange={(v) => setFace({ h: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </div>
        </Group>
      )}

      <Group label="Output">
        <div className="grid grid-cols-2 gap-1.5">
          {(["9:16", "16:9", "1:1", "4:5"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAspect(a)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm transition",
                project.aspectRatio === a ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white" : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              {ASPECT_LABELS[a]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
          Exports at {dims.w}x{dims.h}. 9:16 covers Shorts, TikTok, Reels, and X.
        </p>
      </Group>

      {showReframe && (
        <>
          <RangeField label="Zoom" value={Math.max(1, r.scale)} min={1} max={4} step={0.05} onChange={(v) => api.patch({ reframe: { ...r, scale: v } })} format={(v) => `${v.toFixed(2)}x`} />
          <RangeField label="Pan X" value={r.offsetX} min={-1} max={1} step={0.02} onChange={(v) => api.patch({ reframe: { ...r, offsetX: v } })} />
          <RangeField label="Pan Y" value={r.offsetY} min={-1} max={1} step={0.02} onChange={(v) => api.patch({ reframe: { ...r, offsetY: v } })} />
          <p className="text-xs text-[var(--muted-foreground)]">Tip: drag the preview to pan; double-click it to re-center.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => api.patch({ reframe: { ...r, offsetX: 0, offsetY: 0 } })}>
              Center
            </Button>
            <Button variant="ghost" onClick={() => api.patch({ reframe: { scale: 1, offsetX: 0, offsetY: 0 } })}>
              Reset zoom & pan
            </Button>
          </div>
        </>
      )}
    </div>
  );
});

// --- Overlays panel --------------------------------------------------------

export const OverlaysPanel = memo(function OverlaysPanel({ api }: { api: EditorApi }) {
  const { project } = api;
  const { data, mutate } = useAppData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingKind, setPendingKind] = useState<OverlayKind>("image");
  const selected = project.overlays.find((o) => o.id === api.selectedOverlayId) ?? null;

  const brand = data.brandAssets ?? {};

  // A brand asset is "on" when an overlay of its kind carries the saved image.
  const brandOverlays = (kind: "logo" | "watermark", src: string) => project.overlays.filter((o) => o.kind === kind && o.src === src);
  const toggleBrand = (kind: "logo" | "watermark", src: string, on: boolean) => {
    if (on) api.addOverlay(kind, src);
    else brandOverlays(kind, src).forEach((o) => api.deleteOverlay(o.id));
  };

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      // Logos and watermarks become the saved default, reusable in every clip;
      // replacing one also swaps out any copy of the old image on this clip.
      if (pendingKind === "logo" || pendingKind === "watermark") {
        const prev = pendingKind === "logo" ? brand.logoSrc : brand.watermarkSrc;
        if (prev) brandOverlays(pendingKind, prev).forEach((o) => api.deleteOverlay(o.id));
        void mutate("updateBrandAssets", { ...brand, [pendingKind === "logo" ? "logoSrc" : "watermarkSrc"]: src });
      }
      api.addOverlay(pendingKind, src);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        <AddBtn icon={<Type className="h-4 w-4" />} label="Text" onClick={() => api.addOverlay("text")} />
        <AddBtn icon={<ImageIcon className="h-4 w-4" />} label="Image" onClick={() => { setPendingKind("image"); fileRef.current?.click(); }} />
        <AddBtn icon={<ImageIcon className="h-4 w-4" />} label="Logo" onClick={() => { setPendingKind("logo"); fileRef.current?.click(); }} />
        <AddBtn icon={<ImageIcon className="h-4 w-4" />} label="Watermark" onClick={() => { setPendingKind("watermark"); fileRef.current?.click(); }} />
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImage} />

      <Group label="Brand kit">
        {!brand.logoSrc && !brand.watermarkSrc ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            Upload a logo or watermark once — it&apos;s saved as your default and can be toggled on in any clip.
          </p>
        ) : (
          <div className="space-y-1.5">
            {([
              { kind: "logo" as const, label: "Default logo", src: brand.logoSrc },
              { kind: "watermark" as const, label: "Default watermark", src: brand.watermarkSrc }
            ]).map(({ kind, label, src }) =>
              src ? (
                <div key={kind} className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-7 w-7 shrink-0 rounded bg-black/40 object-contain" />
                  <Toggle label={label} checked={brandOverlays(kind, src).length > 0} onChange={(v) => toggleBrand(kind, src, v)} />
                  <button
                    type="button"
                    onClick={() => { setPendingKind(kind); fileRef.current?.click(); }}
                    className="ml-auto text-xs text-[var(--muted-foreground)] transition hover:text-white"
                  >
                    Replace
                  </button>
                </div>
              ) : null
            )}
          </div>
        )}
      </Group>

      <div className="max-h-[22vh] space-y-1.5 overflow-y-auto pr-1">
        {project.overlays.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No overlays. Add text (double-click it on the preview to edit), an image, logo, or watermark.
          </p>
        ) : (
          [...project.overlays].sort((a, b) => b.z - a.z).map((o) => (
            <div
              key={o.id}
              onClick={() => api.setSelectedOverlayId(o.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition",
                api.selectedOverlayId === o.id ? "border-[var(--accent)]/60 bg-[var(--accent)]/8 text-white" : "border-[var(--border)] text-[var(--muted-foreground)]"
              )}
            >
              <span className="truncate">{o.kind === "text" ? o.text || o.kind : o.kind}</span>
              <div className="ml-auto flex items-center gap-1">
                <IconBtn title="Layer up" onClick={() => api.reorderOverlay(o.id, "up")}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                <IconBtn title="Layer down" onClick={() => api.reorderOverlay(o.id, "down")}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                <IconBtn title={o.locked ? "Unlock" : "Lock"} onClick={() => api.updateOverlay(o.id, { locked: !o.locked })}>
                  {o.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </IconBtn>
                <IconBtn title="Duplicate" onClick={() => api.duplicateOverlay(o.id)}><Copy className="h-3.5 w-3.5" /></IconBtn>
                <IconBtn title="Delete" onClick={() => api.deleteOverlay(o.id)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
              </div>
            </div>
          ))
        )}
      </div>

      {selected && (
        <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
          {selected.kind === "text" && (
            <>
              <Field label="Text">
                <textarea
                  value={selected.text ?? ""}
                  onChange={(e) => api.updateOverlay(selected.id, { text: e.target.value })}
                  rows={2}
                  className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2 text-sm text-white outline-none focus:border-[var(--accent)]"
                />
              </Field>
              <ColorField label="Colour" value={selected.color ?? "#bd93f9"} onChange={(v) => api.updateOverlay(selected.id, { color: v })} />
            </>
          )}
          <RangeField label="Scale" value={selected.scale} min={0.1} max={5} step={0.05} onChange={(v) => api.updateOverlay(selected.id, { scale: v })} format={(v) => `${v.toFixed(2)}×`} />
          <RangeField label="Rotation" value={selected.rotation} min={-180} max={180} step={1} onChange={(v) => api.updateOverlay(selected.id, { rotation: v })} format={(v) => `${v}°`} />
          <RangeField label="Opacity" value={selected.opacity} min={0} max={1} step={0.05} onChange={(v) => api.updateOverlay(selected.id, { opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Start (s)" value={Number(selected.start.toFixed(2))} min={0} step={0.1} onChange={(v) => api.updateOverlay(selected.id, { start: v })} />
            <NumberField label="End (s)" value={Number(selected.end.toFixed(2))} min={0} step={0.1} onChange={(v) => api.updateOverlay(selected.id, { end: v })} />
          </div>
        </div>
      )}
    </div>
  );
});

// --- Audio panel -----------------------------------------------------------

export const AudioPanel = memo(function AudioPanel({ api }: { api: EditorApi }) {
  const a = api.project.audio;
  const set = (partial: Partial<typeof a>) => api.patch({ audio: { ...a, ...partial } });
  const musicRef = useRef<HTMLInputElement>(null);

  const onPickMusic = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ musicSrc: String(reader.result), musicName: file.name });
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <RangeField label="Clip volume" value={a.clipVolume} min={0} max={2} step={0.05} onChange={(v) => set({ clipVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
      <div className="grid grid-cols-2 gap-3">
        <RangeField label="Fade in" value={a.fadeIn} min={0} max={5} step={0.1} onChange={(v) => set({ fadeIn: v })} format={(v) => `${v.toFixed(1)}s`} />
        <RangeField label="Fade out" value={a.fadeOut} min={0} max={5} step={0.1} onChange={(v) => set({ fadeOut: v })} format={(v) => `${v.toFixed(1)}s`} />
      </div>
      <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white">Background music</span>
          <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => musicRef.current?.click()}>
            {a.musicSrc ? "Replace" : "Add track"}
          </Button>
        </div>
        <input ref={musicRef} type="file" accept="audio/*" hidden onChange={onPickMusic} />
        {a.musicSrc ? (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
              <span className="truncate">{a.musicName ?? "music track"}</span>
              <button type="button" onClick={() => set({ musicSrc: undefined, musicName: undefined })} className="text-red-300 hover:text-red-200">
                Remove
              </button>
            </div>
            <RangeField label="Music volume" value={a.musicVolume} min={0} max={2} step={0.05} onChange={(v) => set({ musicVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">No music added. The clip’s own audio plays at the volume above.</p>
        )}
      </div>
      <SfxSection value={api.project.sfx} onChange={(sfx) => api.patch({ sfx })} />
    </div>
  );
});

// --- Export panel ----------------------------------------------------------

export const ExportPanel = memo(function ExportPanel({ api }: { api: EditorApi }) {
  const e = api.project.exportSettings;
  const set = (partial: Partial<typeof e>) => api.patch({ exportSettings: { ...e, ...partial } });
  const state = api.exportState;
  const [savingToFolder, setSavingToFolder] = useState(false);

  const applyPreset = (preset: ExportPresetId) => {
    const p = EXPORT_PRESETS[preset];
    set({ preset, width: p.w, height: p.h });
    if (p.aspect !== "custom") api.patch({ aspectRatio: p.aspect });
  };

  // "Take clip to folder": use the File System Access API so the user picks the
  // destination folder instead of the file landing in the browser's downloads.
  const saveToFolder = async () => {
    if (state.status !== "done" || !state.exportId) return;
    const suggestedName = `${e.filename || "clip"}.${e.format}`;
    const url = `/api/clips/${api.project.jobId}/export/${state.exportId}?file=1&download=1`;

    const picker = (window as unknown as { showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;

    // Browsers without the File System Access API (e.g. Firefox/Safari) fall
    // back to a normal download.
    if (!picker) {
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      a.click();
      return;
    }

    setSavingToFolder(true);
    try {
      const mime = e.format === "webm" ? "video/webm" : "video/mp4";
      const handle = await picker({
        suggestedName,
        types: [{ description: "Video", accept: { [mime]: [`.${e.format}`] } }]
      });
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not fetch the exported file.");
      const blob = await res.blob();
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (err) {
      // AbortError = the user closed the folder picker; not worth surfacing.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("Save to folder failed", err);
      }
    } finally {
      setSavingToFolder(false);
    }
  };

  return (
    <div className="space-y-4">
      <Group label="Target">
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(EXPORT_PRESETS) as ExportPresetId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => applyPreset(id)}
              className={cn(
                "rounded-lg border px-2.5 py-2 text-xs transition",
                e.preset === id ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white" : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              {EXPORT_PRESETS[id].label}
            </button>
          ))}
        </div>
      </Group>

      {e.preset === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Width" value={e.width} min={64} max={4096} onChange={(v) => set({ width: v })} />
          <NumberField label="Height" value={e.height} min={64} max={4096} onChange={(v) => set({ height: v })} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Frame rate" value={String(e.fps)} onChange={(v) => set({ fps: Number(v) })} options={[
          { value: "24", label: "24 fps" },
          { value: "30", label: "30 fps" },
          { value: "60", label: "60 fps" }
        ]} />
        <SelectField label="Quality" value={e.quality} onChange={(v) => set({ quality: v })} options={[
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" }
        ]} />
      </div>
      <SelectField label="Format" value={e.format} onChange={(v) => set({ format: v })} options={[
        { value: "mp4", label: "MP4 (H.264)" },
        { value: "webm", label: "WebM (VP9)" }
      ]} />

      <div className="space-y-2">
        <Toggle label="Burn captions into video" checked={e.burnCaptions} onChange={(v) => set({ burnCaptions: v })} />
        <Toggle label="CoLateral AI watermark" checked={e.watermark} onChange={(v) => set({ watermark: v })} />
      </div>

      <PublishMetaSection api={api} />

      <div className="rounded-lg border border-[var(--border)] p-3">
        {state.status === "processing" || state.status === "starting" ? (
          <div className="flex gap-2">
            <Button disabled className="flex-1">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {state.status === "processing" ? `Rendering ${state.progress}%` : "Starting…"}
            </Button>
            <Button variant="danger" onClick={api.stopExport} title="Stop this render">
              <Square className="mr-2 h-4 w-4" /> Stop
            </Button>
          </div>
        ) : (
          <Button onClick={api.runExport} className="w-full">
            <Download className="mr-2 h-4 w-4" /> Export video
          </Button>
        )}

        {(state.status === "processing" || state.status === "starting") && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${state.progress}%` }} />
          </div>
        )}

        {state.status === "canceled" && <p className="mt-2 text-sm text-[var(--muted-foreground)]">Render stopped. Press Export video to try again.</p>}

        {state.status === "error" && <p className="mt-2 text-sm text-red-300">{state.error}</p>}

        {state.status === "done" && state.exportId && (
          <div className="mt-3 space-y-2 rounded-lg border border-emerald-400/30 bg-emerald-400/8 p-3">
            <p className="flex items-center gap-2 text-sm text-emerald-200">
              <Check className="h-4 w-4" /> Export complete — file is playable.
            </p>
            <video
              src={`/api/clips/${api.project.jobId}/export/${state.exportId}?file=1`}
              controls
              className="w-full rounded-md bg-black"
              style={{ maxHeight: "30vh" }}
            />
            {(() => {
              const downloadName = safeFilename(api.project.name || e.filename);
              return (
                <a
                  href={`/api/clips/${api.project.jobId}/export/${state.exportId}?file=1&download=1&name=${encodeURIComponent(
                    downloadName
                  )}`}
                  download={`${downloadName}.${e.format}`}
                >
                  <Button variant="secondary" className="w-full">
                    <Download className="mr-2 h-4 w-4" /> Download {downloadName}.{e.format}
                  </Button>
                </a>
              );
            })()}
            <Button variant="secondary" className="w-full" onClick={saveToFolder} disabled={savingToFolder}>
              {savingToFolder ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FolderDown className="mr-2 h-4 w-4" />
              )}
              Take clip to folder
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});

// --- Publish metadata (titles + description) -------------------------------

/** Suggested, YouTube-ready alternative titles, a description, and hashtags —
 *  all derived from the clip's captions. Click a title to apply it; copy the
 *  description or hashtags straight into the upload form. */
function PublishMetaSection({ api }: { api: EditorApi }) {
  const { captions, title } = api.project;

  const titleOptions = useMemo(() => generateClipTitleCandidates(captions).slice(0, 5), [captions]);
  const hashtags = useMemo(() => generateClipHashtags(captions), [captions]);
  const suggestedDescription = useMemo(() => generateClipDescription(captions), [captions]);

  // The description is editable; reseed it whenever the captions change enough
  // to produce a different suggestion (and the user hasn't diverged from it).
  // Adjusting state during render is React's recommended pattern here — it
  // avoids a wasted commit + effect pass.
  const [description, setDescription] = useState(suggestedDescription);
  const [edited, setEdited] = useState(false);
  const [lastSuggestion, setLastSuggestion] = useState(suggestedDescription);
  if (suggestedDescription !== lastSuggestion) {
    setLastSuggestion(suggestedDescription);
    if (!edited) setDescription(suggestedDescription);
  }

  if (captions.length === 0) {
    return (
      <Group label="Titles & description">
        <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)]">
          Add captions on the <strong>Captions</strong> tab (or hit <strong>Regenerate</strong>) and we&apos;ll suggest
          YouTube-ready titles, a description, and hashtags here.
        </p>
      </Group>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-[var(--border)] bg-black/20 p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--accent)]" />
        <p className="text-sm font-medium text-white">Titles &amp; description</p>
      </div>

      <Group label="Suggested titles">
        {titleOptions.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">Not enough caption text to suggest titles yet.</p>
        ) : (
          <div className="space-y-1.5">
            {titleOptions.map((option) => {
              const active = option === title;
              return (
                <div
                  key={option}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition",
                    active ? "border-[var(--accent)]/60 bg-[var(--accent)]/8" : "border-[var(--border)]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => api.patch({ title: option, name: option })}
                    title="Use this title"
                    className="min-w-0 flex-1 truncate text-left text-sm text-white hover:text-[var(--accent)]"
                  >
                    {option}
                  </button>
                  {active ? (
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--accent)]">In use</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => api.patch({ title: option, name: option })}
                      className="shrink-0 rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-white"
                    >
                      Use
                    </button>
                  )}
                  <CopyButton value={option} title="Copy title" />
                </div>
              );
            })}
          </div>
        )}
      </Group>

      <Group label="Suggested description">
        <textarea
          value={description}
          onChange={(ev) => {
            setEdited(true);
            setDescription(ev.target.value);
          }}
          rows={5}
          className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2 text-sm text-white outline-none focus:border-[var(--accent)]"
        />
        <div className="flex items-center gap-2">
          <CopyButton value={description} title="Copy description" label="Copy" />
          {edited && (
            <button
              type="button"
              onClick={() => {
                setEdited(false);
                setDescription(suggestedDescription);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reset
            </button>
          )}
        </div>
      </Group>

      {hashtags.length > 0 && (
        <Group label="Hashtags">
          <div className="flex flex-wrap items-center gap-1.5">
            {hashtags.map((tag) => (
              <span key={tag} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)]">
                {tag}
              </span>
            ))}
            <CopyButton value={hashtags.join(" ")} title="Copy hashtags" label="Copy" />
          </div>
        </Group>
      )}
    </div>
  );
}

function CopyButton({ value, title, label }: { value: string; title: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. insecure context) — nothing useful to surface.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-xs transition hover:border-[var(--accent)] hover:text-white",
        copied ? "text-emerald-300" : "text-[var(--muted-foreground)]"
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}

// --- small shared bits -----------------------------------------------------

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded-md p-1 text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

function AddBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-lg border border-[var(--border)] py-2 text-xs text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-white"
    >
      {icon}
      {label}
    </button>
  );
}
