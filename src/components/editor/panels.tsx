"use client";

import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  Lock,
  Merge,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  Type,
  Unlock,
  X
} from "lucide-react";
import { CAPTION_PRESETS } from "@/lib/clipping/captions";
import { ASPECT_LABELS, EXPORT_PRESETS, applyCaptionPreset, aspectDimensions, formatClock } from "@/lib/clipping/editor";
import { Button } from "@/components/ui/button";
import { ColorField, Field, NumberField, RangeField, SelectField, Toggle } from "@/components/editor/controls";
import { cn } from "@/lib/utils";
import type { AspectRatioId, CaptionPresetId, ExportPresetId, OverlayKind } from "@/types/domain";
import type { EditorApi } from "@/components/editor/types";

// --- Captions panel --------------------------------------------------------

export function CaptionsPanel({ api }: { api: EditorApi }) {
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
}

// --- Transcript panel ------------------------------------------------------

export function TranscriptPanel({ api }: { api: EditorApi }) {
  const { project } = api;
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const term = api.search.trim().toLowerCase();
  const matches = term ? project.captions.filter((c) => c.text.toLowerCase().includes(term)) : project.captions;

  const toggleSelect = (start: number, end: number) => {
    if (selStart === null) {
      setSelStart(start);
      setSelEnd(end);
    } else {
      setSelStart(Math.min(selStart, start));
      setSelEnd(Math.max(selEnd ?? end, end));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5">
        <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
        <input
          value={api.search}
          onChange={(e) => api.setSearch(e.target.value)}
          placeholder="Search transcript"
          className="h-9 w-full bg-transparent text-sm text-white outline-none"
        />
      </div>

      {selStart !== null && selEnd !== null && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-2 text-xs text-white">
          <span>
            Selected {formatClock(selStart)} → {formatClock(selEnd)}
          </span>
          <div className="flex gap-1.5">
            <Button
              className="px-2 py-1 text-xs"
              onClick={() => {
                api.createClipFromRange(selStart, selEnd);
                setSelStart(null);
                setSelEnd(null);
              }}
            >
              Make clip
            </Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setSelStart(null); setSelEnd(null); }}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {project.captions.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No transcript yet — regenerate captions in the Captions tab.</p>
      ) : (
        <div className="max-h-[48vh] space-y-1 overflow-y-auto pr-1 text-sm leading-relaxed">
          {matches.map((c) => (
            <span
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                if (e.shiftKey) toggleSelect(c.start, c.end);
                else api.seek(c.start);
              }}
              className="mr-1 inline cursor-pointer rounded px-0.5 text-[var(--muted-foreground)] hover:bg-white/10 hover:text-white"
              title={`${formatClock(c.start)} — click to seek, shift-click to select range`}
            >
              {c.text}{" "}
            </span>
          ))}
        </div>
      )}
      <p className="text-[11px] text-white/40">Click to seek · Shift-click two lines to select a range, then “Make clip”.</p>
    </div>
  );
}

// --- Style panel -----------------------------------------------------------

export function StylePanel({ api }: { api: EditorApi }) {
  const s = api.project.captionStyle;
  const set = (partial: Partial<typeof s>) => api.patch({ captionStyle: { ...s, ...partial } });

  return (
    <div className="space-y-4">
      <Field label="Presets">
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
      </Field>

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
          onChange={(v) => set({ position: v })}
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
}

// --- Reframe panel ---------------------------------------------------------

export function TrimPanel({ api }: { api: EditorApi }) {
  const { project } = api;
  const duration = project.baseDurationSec;
  const trimStart = Math.max(0, Math.min(project.trimStart ?? 0, duration));
  const trimEnd = Math.max(trimStart + 0.1, Math.min(project.trimEnd || duration, duration));
  const setStart = (value: number) => api.setTrim(value, Math.max(value + 0.1, trimEnd));
  const setEnd = (value: number) => api.setTrim(Math.min(trimStart, value - 0.1), value);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] bg-black/20 p-3">
        <p className="text-sm font-semibold text-white">Clip trim</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Playback and export use this range: {formatClock(trimStart)} to {formatClock(trimEnd)}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Start" value={Number(trimStart.toFixed(2))} min={0} max={trimEnd - 0.1} step={0.05} onChange={setStart} />
        <NumberField label="End" value={Number(trimEnd.toFixed(2))} min={trimStart + 0.1} max={duration} step={0.05} onChange={setEnd} />
      </div>

      <RangeField label="Trim start" value={trimStart} min={0} max={Math.max(0.1, trimEnd - 0.1)} step={0.05} onChange={setStart} format={formatClock} />
      <RangeField label="Trim end" value={trimEnd} min={Math.min(duration, trimStart + 0.1)} max={duration} step={0.05} onChange={setEnd} format={formatClock} />

      <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
        <Field label="Generated title">
          <input
            value={project.title || project.name}
            onChange={(event) => api.patch({ title: event.target.value, name: event.target.value })}
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-sm text-white outline-none focus:border-[var(--accent)]"
          />
        </Field>
        <Button variant="secondary" onClick={api.generateTitle} disabled={api.fetchingCaptions}>
          {api.fetchingCaptions ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Generate from captions
        </Button>
      </div>
    </div>
  );
}

export function ReframePanel({ api }: { api: EditorApi }) {
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

  return (
    <div className="space-y-4">
      <Field label="Aspect ratio">
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
      </Field>
      <p className="text-xs text-[var(--muted-foreground)]">
        Output {dims.w}x{dims.h}. Drag the preview to pan, then zoom to crop tighter around the subject.
      </p>
      <RangeField label="Crop zoom" value={Math.max(1, r.scale)} min={1} max={4} step={0.05} onChange={(v) => api.patch({ reframe: { ...r, scale: v } })} format={(v) => `${v.toFixed(2)}x`} />
      <RangeField label="Pan X" value={r.offsetX} min={-1} max={1} step={0.02} onChange={(v) => api.patch({ reframe: { ...r, offsetX: v } })} />
      <RangeField label="Pan Y" value={r.offsetY} min={-1} max={1} step={0.02} onChange={(v) => api.patch({ reframe: { ...r, offsetY: v } })} />
      <Button variant="ghost" onClick={() => api.patch({ reframe: { scale: 1, offsetX: 0, offsetY: 0 } })}>
        Reset crop
      </Button>
    </div>
  );
}

// --- Overlays panel --------------------------------------------------------

export function OverlaysPanel({ api }: { api: EditorApi }) {
  const { project } = api;
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingKind, setPendingKind] = useState<OverlayKind>("image");
  const selected = project.overlays.find((o) => o.id === api.selectedOverlayId) ?? null;

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => api.addOverlay(pendingKind, String(reader.result));
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        <AddBtn icon={<Type className="h-4 w-4" />} label="Text" onClick={() => api.addOverlay("text")} />
        <AddBtn icon={<Type className="h-4 w-4" />} label="Title card" onClick={() => api.addOverlay("title")} />
        <AddBtn icon={<ImageIcon className="h-4 w-4" />} label="Image" onClick={() => { setPendingKind("image"); fileRef.current?.click(); }} />
        <AddBtn icon={<ImageIcon className="h-4 w-4" />} label="Logo" onClick={() => { setPendingKind("logo"); fileRef.current?.click(); }} />
        <AddBtn icon={<ImageIcon className="h-4 w-4" />} label="Watermark" onClick={() => { setPendingKind("watermark"); fileRef.current?.click(); }} />
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImage} />

      <div className="max-h-[22vh] space-y-1.5 overflow-y-auto pr-1">
        {project.overlays.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No overlays. Add text, a title card, image, logo, or watermark.</p>
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
              <span className="truncate">{o.kind === "text" || o.kind === "title" ? o.text || o.kind : o.kind}</span>
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
          {(selected.kind === "text" || selected.kind === "title") && (
            <>
              <Field label="Text">
                <textarea
                  value={selected.text ?? ""}
                  onChange={(e) => api.updateOverlay(selected.id, { text: e.target.value })}
                  rows={2}
                  className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2 text-sm text-white outline-none focus:border-[var(--accent)]"
                />
              </Field>
              <ColorField label="Colour" value={selected.color ?? "#ffffff"} onChange={(v) => api.updateOverlay(selected.id, { color: v })} />
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
}

// --- Audio panel -----------------------------------------------------------

export function AudioPanel({ api }: { api: EditorApi }) {
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
    </div>
  );
}

// --- Suggestions panel -----------------------------------------------------

export function SuggestionsPanel({ api }: { api: EditorApi }) {
  const { project } = api;
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
        <Sparkles className="h-4 w-4 text-[var(--accent)]" />
        AI-recommended moments from the source analysis. They never change your edits unless you add them.
      </p>
      {project.suggestions.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No suggestions for this clip.</p>
      ) : (
        <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {project.suggestions.map((sug) => (
            <div
              key={sug.id}
              className={cn(
                "rounded-lg border p-2.5",
                sug.status === "approved" && "border-emerald-400/40 bg-emerald-400/8",
                sug.status === "rejected" && "border-red-400/30 bg-red-400/5 opacity-60",
                sug.status === "pending" && "border-[var(--border)] bg-black/20"
              )}
            >
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => api.seek(sug.start)} className="font-mono text-[11px] text-[var(--accent)] hover:underline">
                  {formatClock(sug.start)} → {formatClock(sug.end)}
                </button>
                {sug.score > 0 && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white">Score {sug.score}</span>}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{sug.rationale}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <NumberField label="Start" value={Number(sug.start.toFixed(2))} step={0.1} min={0} onChange={(v) => api.trimSuggestion(sug.id, v, sug.end)} />
                <NumberField label="End" value={Number(sug.end.toFixed(2))} step={0.1} min={0} onChange={(v) => api.trimSuggestion(sug.id, sug.start, v)} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button className="px-2 py-1 text-xs" onClick={() => api.setSuggestionStatus(sug.id, "approved")}>
                  <Check className="mr-1 h-3 w-3" /> Approve
                </Button>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => api.setSuggestionStatus(sug.id, "rejected")}>
                  <X className="mr-1 h-3 w-3" /> Reject
                </Button>
                <Button
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  disabled={sug.addedToTimeline}
                  onClick={() => api.addSuggestionToTimeline(sug.id)}
                >
                  {sug.addedToTimeline ? "Added" : "Add to timeline"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Export panel ----------------------------------------------------------

export function ExportPanel({ api }: { api: EditorApi }) {
  const e = api.project.exportSettings;
  const set = (partial: Partial<typeof e>) => api.patch({ exportSettings: { ...e, ...partial } });
  const state = api.exportState;

  const applyPreset = (preset: ExportPresetId) => {
    const p = EXPORT_PRESETS[preset];
    set({ preset, width: p.w, height: p.h });
    if (p.aspect !== "custom") api.patch({ aspectRatio: p.aspect });
  };

  return (
    <div className="space-y-4">
      <Field label="Target">
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
      </Field>

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

      <Field label="Filename">
        <input
          value={e.filename}
          onChange={(ev) => set({ filename: ev.target.value })}
          className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-sm text-white outline-none focus:border-[var(--accent)]"
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => api.downloadSubtitles("srt")}>
          <Download className="mr-2 h-4 w-4" /> SRT
        </Button>
        <Button variant="secondary" onClick={() => api.downloadSubtitles("vtt")}>
          <Download className="mr-2 h-4 w-4" /> VTT
        </Button>
      </div>

      <div className="rounded-lg border border-[var(--border)] p-3">
        <Button onClick={api.runExport} disabled={state.status === "starting" || state.status === "processing"} className="w-full">
          {state.status === "starting" || state.status === "processing" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          {state.status === "processing" ? `Rendering ${state.progress}%` : "Export video"}
        </Button>

        {(state.status === "processing" || state.status === "starting") && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${state.progress}%` }} />
          </div>
        )}

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
            <a href={`/api/clips/${api.project.jobId}/export/${state.exportId}?file=1&download=1`} download>
              <Button variant="secondary" className="w-full">
                <Download className="mr-2 h-4 w-4" /> Download {e.filename}.{e.format}
              </Button>
            </a>
          </div>
        )}
      </div>
    </div>
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
