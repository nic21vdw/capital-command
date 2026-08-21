"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/clipping/editor";
import { getStyle } from "@/lib/thumbnails/backgrounds";
import { DEFAULT_FONT_ID, ensureFontLoaded, getFont } from "@/lib/thumbnails/fonts";
import { renderThumbnail, renderToDataUrl } from "@/lib/thumbnails/render";
import {
  DEFAULT_TEXT_TRANSFORM,
  DEFAULT_TREATMENT,
  THUMB_HEIGHT,
  THUMB_WIDTH,
  type BackgroundStyleId,
  type ImageLayer,
  type ThumbnailOptions
} from "@/lib/thumbnails/types";
import type { LongformExportRecord, LongformProject } from "@/lib/longform/types";
import { cn } from "@/lib/utils";

const STUDIO_STYLES: BackgroundStyleId[] = ["mega-pop", "tech-glow", "cinematic", "spotlight", "gradient", "aurora"];
const FACE_TRANSFORM = { x: 0.75, y: 0.54, scale: 1.15, rotation: 0 };
const FACE_TREATMENT = {
  ...DEFAULT_TREATMENT,
  cutout: true,
  glow: 0.45,
  shadow: true,
  backlight: true,
  saturate: 1.18,
  contrast: 1.12,
  brightness: 1.04
};

type Candidate = { id: string; seconds: number; score: number; hasFace: boolean };
type Manifest = { key: string; topicId: string | null; candidates: Candidate[]; builtAt: string };

export function ThumbnailPanel({
  project,
  setProject,
  skipDirtyRef,
  activeSegmentId
}: {
  project: LongformProject;
  setProject: React.Dispatch<React.SetStateAction<LongformProject>>;
  skipDirtyRef: React.MutableRefObject<boolean>;
  activeSegmentId: string | null;
}) {
  const topic = activeSegmentId ? project.topics?.find((item) => item.id === activeSegmentId) : undefined;
  const record = useMemo(() => exportForSegment(project, activeSegmentId), [project, activeSegmentId]);

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [sampling, setSampling] = useState(false);
  const [frameId, setFrameId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; image: HTMLImageElement } | null>(null);
  const [hooks, setHooks] = useState<string[]>([]);
  const [hookSource, setHookSource] = useState<"ai" | "offline" | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState(record?.thumbnailHook ?? "");
  const [styleId, setStyleId] = useState<BackgroundStyleId>("mega-pop");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [fontReady, setFontReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const topicQuery = activeSegmentId ? `?topicId=${encodeURIComponent(activeSegmentId)}` : "";

  useEffect(() => {
    void ensureFontLoaded(getFont(DEFAULT_FONT_ID)).then(() => setFontReady(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/longform/projects/${project.id}/thumbnail/candidates${topicQuery}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { candidates: Manifest | null } | null) => {
        if (cancelled || !data?.candidates) return;
        setManifest(data.candidates);
        setFrameId(data.candidates.candidates[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.id, topicQuery]);

  const frameUrl = useCallback(
    (id: string, wantFace: boolean) =>
      `/api/longform/projects/${project.id}/thumbnail/candidates/${id}${wantFace ? "?face=1" : ""}`,
    [project.id]
  );

  const face = loaded && loaded.id === frameId ? loaded.image : null;

  useEffect(() => {
    const chosen = manifest?.candidates.find((item) => item.id === frameId);
    if (!chosen) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!cancelled) setLoaded({ id: chosen.id, image });
    };
    image.src = frameUrl(chosen.id, chosen.hasFace);
    return () => {
      cancelled = true;
    };
  }, [manifest, frameId, frameUrl]);

  const options: ThumbnailOptions = useMemo(() => {
    const images: ImageLayer[] = face
      ? [{ id: "face", name: "Subject", image: face, transform: { ...FACE_TRANSFORM }, treatment: { ...FACE_TREATMENT } }]
      : [];
    return {
      images,
      text: text || topic?.title || project.name,
      textTransform: { ...DEFAULT_TEXT_TRANSFORM },
      manualLayout: false,
      style: styleId,
      paletteIndex,
      intensity: "bold",
      emphasis: "outline",
      position: "left",
      size: "large",
      uppercase: true,
      bold: true,
      italic: false,
      underline: false,
      fontId: DEFAULT_FONT_ID,
      textColor: "auto",
      highlightColor: getStyle(styleId).palettes[paletteIndex % getStyle(styleId).palettes.length].accent,
      stickers: []
    };
  }, [face, text, topic?.title, project.name, styleId, paletteIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fontReady) return;
    renderThumbnail(canvas, options);
  }, [options, fontReady]);

  const sample = useCallback(async () => {
    setSampling(true);
    try {
      const response = await fetch(`/api/longform/projects/${project.id}/thumbnail/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: activeSegmentId })
      });
      const data = (await response.json()) as { candidates?: Manifest; error?: string };
      if (!response.ok || !data.candidates) throw new Error(data.error ?? "Frames could not be read.");
      setManifest(data.candidates);
      setFrameId(data.candidates.candidates[0]?.id ?? null);
      toast.success(`${data.candidates.candidates.length} frames to choose from`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Frames could not be read.");
    } finally {
      setSampling(false);
    }
  }, [project.id, activeSegmentId]);

  const writeHooks = useCallback(async () => {
    setWriting(true);
    try {
      const response = await fetch(`/api/longform/projects/${project.id}/thumbnail/hooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: activeSegmentId })
      });
      const data = (await response.json()) as { hooks?: string[]; source?: "ai" | "offline"; error?: string };
      if (!response.ok || !data.hooks?.length) throw new Error(data.error ?? "No hook lines came back.");
      setHooks(data.hooks);
      setHookSource(data.source ?? null);
      if (!text) setText(data.hooks[0]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No hook lines came back.");
    } finally {
      setWriting(false);
    }
  }, [project.id, activeSegmentId, text]);

  const save = useCallback(async () => {
    if (!record) return;
    setSaving(true);
    try {
      const png = renderToDataUrl(options, "png");
      const response = await fetch(`/api/longform/projects/${project.id}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportId: record.id, png, hook: text })
      });
      const data = (await response.json()) as { export?: LongformExportRecord; error?: string };
      if (!response.ok || !data.export) throw new Error(data.error ?? "The thumbnail could not be saved.");
      skipDirtyRef.current = true;
      setProject((current) => ({
        ...current,
        exports: current.exports.map((item) => (item.id === data.export!.id ? data.export! : item))
      }));
      toast.success("Thumbnail saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The thumbnail could not be saved.");
    } finally {
      setSaving(false);
    }
  }, [record, options, project.id, text, setProject, skipDirtyRef]);

  const style = getStyle(styleId);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">Thumbnail</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            {topic ? topic.title : "Full recording"} — pick the frame, then the words.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void sample()} disabled={sampling}>
          {sampling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {manifest ? "Sample again" : "Find frames"}
        </Button>
      </div>

      {!manifest && !sampling && (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted-foreground)]">
          Nothing sampled yet. Find frames reads through this{" "}
          {topic ? "segment" : "recording"}, scores what it sees and keeps the six clearest shots of you.
        </p>
      )}

      {manifest && manifest.candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Frames</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {manifest.candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setFrameId(candidate.id)}
                className={cn(
                  "relative h-16 w-16 flex-none overflow-hidden rounded-lg border-2 transition",
                  candidate.id === frameId ? "border-[var(--accent)]" : "border-transparent hover:border-white/25"
                )}
                title={`${formatClock(candidate.seconds)} · score ${Math.round(candidate.score * 100)}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frameUrl(candidate.id, candidate.hasFace)}
                  alt={`Frame at ${formatClock(candidate.seconds)}`}
                  className="h-full w-full object-cover"
                />
                <span className="absolute inset-x-0 bottom-0 bg-black/70 text-[9px] font-semibold text-white">
                  {Math.round(candidate.score * 100)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Hook line</p>
          <Button variant="ghost" onClick={() => void writeHooks()} disabled={writing}>
            {writing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Write me three
          </Button>
        </div>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={60}
          placeholder="Wrap the word to colour in *asterisks*"
          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
          aria-label="Thumbnail hook line"
        />
        {hooks.length > 0 && (
          <div className="space-y-1">
            {hooks.map((hook) => (
              <button
                key={hook}
                type="button"
                onClick={() => setText(hook)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition",
                  hook === text
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-white/25"
                )}
              >
                {hook === text && <Check className="h-3 w-3 flex-none text-[var(--accent)]" />}
                <span className="truncate">{hook}</span>
              </button>
            ))}
            {hookSource === "offline" && (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Written from the title — the model was not reachable.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Look</p>
        <div className="flex flex-wrap gap-1.5">
          {STUDIO_STYLES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setStyleId(id);
                setPaletteIndex(0);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition",
                id === styleId
                  ? "border-[var(--accent)] text-white"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-white/25"
              )}
            >
              {getStyle(id).label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {style.palettes.map((palette, index) => (
            <button
              key={palette.name}
              type="button"
              onClick={() => setPaletteIndex(index)}
              title={palette.name}
              aria-label={palette.name}
              className={cn(
                "h-7 w-7 rounded-lg border-2 transition",
                index === paletteIndex % style.palettes.length ? "border-white" : "border-white/10 hover:border-white/40"
              )}
              style={{ background: `linear-gradient(135deg, ${palette.bg2}, ${palette.accent})` }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Preview</p>
        <canvas
          ref={canvasRef}
          width={THUMB_WIDTH}
          height={THUMB_HEIGHT}
          className="w-full rounded-lg border border-[var(--border)]"
        />
      </div>

      {record ? (
        <Button className="w-full" onClick={() => void save()} disabled={saving || !fontReady}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {record.thumbnailFile ? "Replace thumbnail" : "Save as thumbnail"}
        </Button>
      ) : (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)]">
          Render this {topic ? "segment" : "recording"} first — a thumbnail is saved beside the video it belongs to.
        </p>
      )}
    </div>
  );
}

function exportForSegment(project: LongformProject, topicId: string | null): LongformExportRecord | undefined {
  const done = project.exports.filter((record) => record.status === "done" && record.file);
  if (topicId) return done.find((record) => record.topicId === topicId);
  const whole = done.filter((record) => !record.topicId);
  return whole.reduce<LongformExportRecord | undefined>(
    (newest, record) => (!newest || Date.parse(record.createdAt) > Date.parse(newest.createdAt) ? record : newest),
    undefined
  );
}
