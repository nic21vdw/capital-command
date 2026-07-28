"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarClock,
  ChevronDown,
  Download,
  Eye,
  ImagePlus,
  Images,
  Layers,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { ScheduleCalendar } from "@/components/carousels/schedule-calendar";
import { ScheduleModal } from "@/components/carousels/schedule-modal";
import { SlideEditor } from "@/components/carousels/slide-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  carouselAngle,
  MAX_BATCH_COUNT,
  MAX_SLIDES,
  MIN_SLIDES,
  resolveSlideCount
} from "@/lib/carousels/deck";
import type { CarouselImage } from "@/lib/carousels/imageSlides";
import {
  ASPECT_RATIO_LIST,
  aspectSpec,
  carouselBaseName,
  DEFAULT_ASPECT_RATIO,
  downloadSlide,
  renderSlideCanvas
} from "@/lib/carousels/render";
import { cn } from "@/lib/utils";
import type { Carousel, CarouselAspectRatio, CarouselSchedule, CarouselSlide } from "@/types/domain";

/**
 * Carousels: turn a script, a long-form video's transcript, a short-form video
 * (a clip), a batch of uploaded photos, or pasted text into swipeable carousels
 * distributable to Instagram, Facebook, and TikTok. One source can produce
 * several carousels at once — each batch takes its own angle. Copy is generated
 * server-side; the slides are drawn on a canvas here (any aspect ratio),
 * double-click to preview or open the editor, download in any format, or
 * schedule the upload across networks.
 */

type LongformListItem = { id: string; name: string; status: string; transcript?: unknown[] };

// A single ready clip flattened out of the clip jobs, offered as a carousel source.
type ShortOption = { jobId: string; clipId: string; label: string };

type SourceType = "script" | "longform" | "short" | "custom" | "images";

// Human-readable label for a carousel's source, shown on each card.
const SOURCE_LABEL: Record<Carousel["sourceType"], string> = {
  script: "script",
  longform: "video",
  short: "short-form video",
  custom: "text",
  images: "photos"
};

const SLIDE_COUNT_OPTIONS = Array.from({ length: MAX_SLIDES - MIN_SLIDES + 1 }, (_, i) => MIN_SLIDES + i);

export function CarouselsPage() {
  const { data, loading, refresh } = useAppData();
  const carousels = useMemo(() => data.videoStudio?.carousels ?? [], [data.videoStudio]);
  const scripts = useMemo(() => data.videoStudio?.scripts ?? [], [data.videoStudio]);

  // Arriving from the Stream Pipeline's carousel row: the stream's transcript is
  // already the source, so the photos and the batch count are all that's left.
  const presetLongform = useSearchParams().get("longform");

  const [projects, setProjects] = useState<LongformListItem[]>([]);
  const [shorts, setShorts] = useState<ShortOption[]>([]);
  const [sourceType, setSourceType] = useState<SourceType>(presetLongform ? "longform" : "script");
  const [sourceId, setSourceId] = useState(presetLongform ?? "");
  const [customTitle, setCustomTitle] = useState("");
  const [customText, setCustomText] = useState("");
  const [slideCount, setSlideCount] = useState(8);
  const [batchCount, setBatchCount] = useState(1);
  const [images, setImages] = useState<CarouselImage[]>([]);
  const [imageNotes, setImageNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [imageDrag, setImageDrag] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // Photos claim a slide each, so they can push the deck past the picked count.
  const deckSlides = resolveSlideCount({ slideCount, imageCount: images.length });

  useEffect(() => {
    void fetch("/api/longform/projects", { cache: "no-store" })
      .then((response) => response.json())
      .then((json: { projects?: LongformListItem[] }) => setProjects((json.projects ?? []).filter((p) => p.status === "ready")))
      .catch(() => undefined);
  }, []);

  // Flatten every finished clip job into individual short-form videos to pick from.
  useEffect(() => {
    type ClipJobListItem = { id: string; fileName: string; topic?: string; status: string; clips: Array<{ id: string; title?: string }> };
    void fetch("/api/clips", { cache: "no-store" })
      .then((response) => response.json())
      .then((json: { jobs?: ClipJobListItem[] }) => {
        const options: ShortOption[] = [];
        for (const job of json.jobs ?? []) {
          if (job.status !== "done") continue;
          job.clips.forEach((clip, index) => {
            options.push({
              jobId: job.id,
              clipId: clip.id,
              label: `${clip.title?.trim() || `Clip ${index + 1}`} · ${job.topic?.trim() || job.fileName}`
            });
          });
        }
        setShorts(options);
      })
      .catch(() => undefined);
  }, []);

  const prepare = useCallback(
    async (carouselId: string) => {
      const carousel = carousels.find((entry) => entry.id === carouselId);
      if (!carousel) return;
      const carouselRatio = carousel.aspectRatio ?? DEFAULT_ASPECT_RATIO;
      const base = carouselBaseName(carousel.title);
      try {
        for (let index = 0; index < carousel.slides.length; index += 1) {
          await downloadSlide(carousel.slides[index], index, carousel.slides.length, carouselRatio, base);
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        toast.success(`“${carousel.title}” is ready — ${carousel.slides.length} slides rendered to post.`);
      } catch {
        toast.error("Could not render the slides.");
      }
    },
    [carousels]
  );

  const unschedule = useCallback(
    async (carouselId: string, scheduleId: string) => {
      const carousel = carousels.find((entry) => entry.id === carouselId);
      if (!carousel) return;
      const next = (carousel.schedules ?? []).filter((entry) => entry.id !== scheduleId);
      const response = await fetch(`/api/studio/carousels/${carouselId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedules: next })
      });
      if (response.ok) {
        toast.success("Schedule removed.");
        void refresh();
      } else {
        toast.error("Could not update the schedule.");
      }
    },
    [carousels, refresh]
  );

  /** Uploads a batch of photos and keeps them in picked order. */
  const addImages = useCallback(async (files: FileList | File[]) => {
    const picked = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (picked.length === 0) return;
    const form = new FormData();
    for (const file of picked) form.append("files", file);
    setUploading(true);
    try {
      const response = await fetch("/api/studio/carousels/images", { method: "POST", body: form });
      const json = (await response.json()) as { images?: CarouselImage[]; rejected?: string[]; error?: string };
      if (!response.ok || !json.images?.length) {
        toast.error(json.error ?? "Could not upload those photos.");
        return;
      }
      setImages((current) => [...current, ...json.images!]);
      if (json.rejected?.length) toast.error(json.rejected.join(" "));
      else toast.success(`${json.images.length} photo${json.images.length === 1 ? "" : "s"} attached.`);
    } catch {
      toast.error("Could not upload those photos.");
    } finally {
      setUploading(false);
    }
  }, []);

  const generate = async () => {
    const body: Record<string, unknown> = { slideCount, batchCount };
    if (images.length > 0) {
      body.imageIds = images.map((image) => image.id);
      body.imageNotes = imageNotes;
    }
    if (sourceType === "script") {
      if (!sourceId) return void toast.error("Pick a script first.");
      body.scriptId = sourceId;
    } else if (sourceType === "longform") {
      if (!sourceId) return void toast.error("Pick a long-form project first.");
      body.longformId = sourceId;
    } else if (sourceType === "short") {
      if (!sourceId) return void toast.error("Pick a short-form video first.");
      const [clipJobId, clipId] = sourceId.split("::");
      body.clipJobId = clipJobId;
      body.clipId = clipId;
    } else if (sourceType === "images") {
      if (images.length === 0) return void toast.error("Attach some photos first.");
      if (!imageNotes.trim()) return void toast.error("Describe what the photos show so the slides can be written.");
      body.title = customTitle || "Photo carousel";
    } else {
      if (!customText.trim()) return void toast.error("Paste some text first.");
      body.text = customText;
      body.title = customTitle || "Carousel";
    }
    setGenerating(true);
    try {
      const response = await fetch("/api/studio/carousels/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = (await response.json()) as { carousels?: Carousel[]; reason?: string | null; error?: string };
      if (!response.ok || !json.carousels?.length) {
        toast.error(json.error ?? "Could not generate the carousel.");
        return;
      }
      setReason(json.reason ?? null);
      const slides = json.carousels.reduce((total, entry) => total + entry.slides.length, 0);
      toast.success(
        json.carousels.length === 1
          ? `Carousel written — ${slides} slides.`
          : `${json.carousels.length} carousels written — ${slides} slides.`
      );
      void refresh();
    } catch {
      toast.error("Could not generate the carousel.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Carousels"
        title="Carousels"
        description="Turn a script, a finished video's transcript, a short-form video, a batch of photos, or pasted text into swipeable carousels — hook slide, value slides, CTA slide — distributable to Instagram, Facebook, and TikTok. Ask for several batches and each one takes a different angle on the same stream. Double-click a slide to preview or edit it, pick an aspect ratio, download, or schedule the upload."
      />

      <Card className="mb-6 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[170px_1fr_130px_130px_auto]">
          <Select
            value={sourceType}
            onChange={(event) => {
              setSourceType(event.target.value as SourceType);
              setSourceId("");
            }}
          >
            <option value="script">From script</option>
            <option value="longform">From video</option>
            <option value="short">From short-form video</option>
            <option value="images">From photos</option>
            <option value="custom">From text</option>
          </Select>

          {sourceType === "script" ? (
            <Select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">Pick a script…</option>
              {scripts.map((script) => (
                <option key={script.id} value={script.id}>
                  {script.title}
                </option>
              ))}
            </Select>
          ) : sourceType === "longform" ? (
            <Select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">Pick a long-form project…</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          ) : sourceType === "short" ? (
            <Select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">
                {shorts.length === 0 ? "No finished short-form videos yet" : "Pick a short-form video…"}
              </option>
              {shorts.map((short) => (
                <option key={`${short.jobId}::${short.clipId}`} value={`${short.jobId}::${short.clipId}`}>
                  {short.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input placeholder="Carousel title" value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} />
          )}

          <Select value={slideCount} onChange={(event) => setSlideCount(Number(event.target.value))} aria-label="Slides per carousel">
            {SLIDE_COUNT_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count} slides
              </option>
            ))}
          </Select>

          <Select
            value={batchCount}
            onChange={(event) => setBatchCount(Number(event.target.value))}
            aria-label="How many carousels to write"
          >
            {Array.from({ length: MAX_BATCH_COUNT }, (_, i) => i + 1).map((count) => (
              <option key={count} value={count}>
                {count} batch{count === 1 ? "" : "es"}
              </option>
            ))}
          </Select>

          <Button onClick={() => void generate()} disabled={generating} className="shrink-0">
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generating ? "Writing…" : "Generate"}
          </Button>
        </div>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted-foreground)]">
          <Layers className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span>
            {batchCount === 1
              ? `One carousel of ${deckSlides} slides`
              : `${batchCount} carousels of ${deckSlides} slides — ${batchCount * deckSlides} in total`}
          </span>
          {batchCount > 1 ? (
            <span className="text-white/70">
              · {Array.from({ length: batchCount }, (_, i) => carouselAngle(i).label).join(" · ")}
            </span>
          ) : null}
          {images.length > 0 && deckSlides > slideCount ? (
            <span className="text-amber-300/90">· raised to {deckSlides} so every photo gets a slide</span>
          ) : null}
        </p>

        {sourceType === "custom" ? (
          <Textarea
            placeholder="Paste the content to turn into slides…"
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
          />
        ) : null}

        <ImageBatch
          images={images}
          notes={imageNotes}
          uploading={uploading}
          dragging={imageDrag}
          required={sourceType === "images"}
          inputRef={imageInputRef}
          onPick={(files) => void addImages(files)}
          onDraggingChange={setImageDrag}
          onNotesChange={setImageNotes}
          onRemove={(id) => setImages((current) => current.filter((image) => image.id !== id))}
          onClear={() => setImages([])}
        />
      </Card>

      {reason ? (
        <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">{reason}</div>
      ) : null}

      {carousels.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Images className="h-8 w-8 text-[var(--accent)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {loading
                ? "Loading…"
                : "No carousels yet — generate one from a script, a video, a short-form video, a batch of photos, or pasted text."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          <ScheduleCalendar carousels={carousels} onUnschedule={unschedule} onPrepare={prepare} />
          {carousels.map((carousel) => (
            <CarouselCard key={carousel.id} carousel={carousel} refresh={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The photo batch: pick or drop images, reorder-by-removal, and say what they
 * show. Uploading happens as soon as they're picked, so the same batch survives
 * a re-generate and can feed several batches of slides. The description is how
 * the model knows what is in them — the copy is written from these words, not
 * from the pixels.
 */
function ImageBatch({
  images,
  notes,
  uploading,
  dragging,
  required,
  inputRef,
  onPick,
  onDraggingChange,
  onNotesChange,
  onRemove,
  onClear
}: {
  images: CarouselImage[];
  notes: string;
  uploading: boolean;
  dragging: boolean;
  required: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (files: FileList | File[]) => void;
  onDraggingChange: (dragging: boolean) => void;
  onNotesChange: (notes: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        onDraggingChange(true);
      }}
      onDragLeave={() => onDraggingChange(false)}
      onDrop={(event) => {
        event.preventDefault();
        onDraggingChange(false);
        if (event.dataTransfer.files.length > 0) onPick(event.dataTransfer.files);
      }}
      className={cn(
        "space-y-3 rounded-xl border border-dashed p-3 transition",
        dragging ? "border-[var(--accent)] bg-white/5" : "border-[var(--border)]"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[var(--muted-foreground)]">
          <span className="font-medium text-white">Slide photos{required ? "" : " (optional)"}</span>
          {images.length > 0
            ? ` · ${images.length} attached, one per slide in this order`
            : " · drop a batch here and each photo gets its own slide"}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            className="gap-1.5 px-3 py-1.5 text-xs"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {uploading ? "Uploading…" : "Add photos"}
          </Button>
          {images.length > 0 ? (
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={onClear}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) onPick(event.target.files);
          event.target.value = "";
        }}
      />

      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <div key={image.id} className="group relative">
              <img
                src={image.url}
                alt={image.fileName ?? `Photo ${index + 1}`}
                className="h-20 w-20 rounded-lg border border-[var(--border)] object-cover"
              />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
                {index + 1}
              </span>
              <button
                type="button"
                onClick={() => onRemove(image.id)}
                aria-label={`Remove ${image.fileName ?? `photo ${index + 1}`}`}
                className="absolute right-1 top-1 rounded bg-black/70 p-0.5 text-white opacity-0 transition group-hover:opacity-100 hover:bg-black"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {images.length > 0 ? (
        <Textarea
          rows={3}
          placeholder="What do these photos show, and how should they be used? One line per photo works best — the slide copy is written from this plus the transcript."
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}

function CarouselCard({ carousel, refresh }: { carousel: Carousel; refresh: () => Promise<void> | void }) {
  const [ratio, setRatio] = useState<CarouselAspectRatio>(carousel.aspectRatio ?? DEFAULT_ASPECT_RATIO);
  const [downloading, setDownloading] = useState(false);
  const [downloadMenu, setDownloadMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ index: number; mode: "preview" | "edit" } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const previewRefs = useRef<Array<HTMLCanvasElement | null>>([]);

  const spec = aspectSpec(ratio);
  const slides = carousel.slides;

  // Draw the small previews (at the selected ratio) once the card mounts and
  // whenever the slides or ratio change.
  useEffect(() => {
    let cancelled = false;
    slides.forEach((slide, index) => {
      void renderSlideCanvas(slide, index, slides.length, ratio).then((full) => {
        if (cancelled) return;
        const target = previewRefs.current[index];
        if (!target) return;
        const ctx = target.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, target.width, target.height);
        ctx.drawImage(full, 0, 0, target.width, target.height);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [slides, ratio]);

  const patchCarousel = useCallback(
    async (patch: Partial<Pick<Carousel, "slides" | "aspectRatio" | "schedules">>) => {
      const response = await fetch(`/api/studio/carousels/${carousel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error("patch failed");
      await refresh();
    },
    [carousel.id, refresh]
  );

  const changeRatio = (next: CarouselAspectRatio) => {
    setRatio(next);
    void patchCarousel({ aspectRatio: next }).catch(() => toast.error("Could not save the aspect ratio."));
  };

  const saveSlides = async (nextSlides: CarouselSlide[]) => {
    setSaving(true);
    try {
      await patchCarousel({ slides: nextSlides });
      toast.success("Carousel saved.");
    } catch {
      toast.error("Could not save the carousel.");
    } finally {
      setSaving(false);
    }
  };

  const createSchedule = async (schedule: CarouselSchedule) => {
    setSaving(true);
    try {
      await patchCarousel({ schedules: [...(carousel.schedules ?? []), schedule] });
      toast.success("Upload scheduled.");
      setScheduleOpen(false);
    } catch {
      toast.error("Could not schedule the upload.");
    } finally {
      setSaving(false);
    }
  };

  const downloadAll = useCallback(
    async (downloadRatio: CarouselAspectRatio) => {
      setDownloading(true);
      setDownloadMenu(false);
      try {
        const base = carouselBaseName(carousel.title);
        for (let index = 0; index < slides.length; index += 1) {
          await downloadSlide(slides[index], index, slides.length, downloadRatio, base);
          // Small gap so the browser doesn't swallow rapid consecutive downloads.
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        toast.success("All slides downloaded — post them in order.");
      } catch {
        toast.error("Could not render the slides.");
      } finally {
        setDownloading(false);
      }
    },
    [carousel.title, slides]
  );

  const remove = async () => {
    if (!window.confirm("Delete this carousel?")) return;
    const response = await fetch(`/api/studio/carousels/${carousel.id}`, { method: "DELETE" });
    if (response.ok) void refresh();
    else toast.error("Could not delete the carousel.");
  };

  // Preview cards: fixed height, width follows the aspect ratio.
  const previewHeight = 260;
  const previewWidth = Math.round((previewHeight * spec.width) / spec.height);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-white">{carousel.title}</h3>
            {carousel.batch ? (
              <Badge>
                Batch {carousel.batch.index}/{carousel.batch.total}
                {carousel.batch.angle ? ` · ${carousel.batch.angle}` : ""}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            {slides.length} slides · from {SOURCE_LABEL[carousel.sourceType] ?? carousel.sourceType} ·{" "}
            {new Date(carousel.createdAt).toLocaleDateString()}
            {carousel.schedules && carousel.schedules.length > 0
              ? ` · ${carousel.schedules.length} schedule${carousel.schedules.length > 1 ? "s" : ""}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={ratio}
            onChange={(event) => changeRatio(event.target.value as CarouselAspectRatio)}
            className="h-8 w-auto px-2 py-0 text-xs"
            aria-label="Aspect ratio"
          >
            {ASPECT_RATIO_LIST.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} · {entry.ratio}
              </option>
            ))}
          </Select>
          <Badge>{spec.badge}</Badge>

          {/* Download with an aspect-ratio dropdown. */}
          <div className="relative">
            <div className="flex">
              <Button
                className="gap-1.5 rounded-r-none px-3 py-1.5 text-xs"
                disabled={downloading}
                onClick={() => void downloadAll(ratio)}
              >
                {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download
              </Button>
              <Button
                className="rounded-l-none border-l border-black/20 px-1.5 py-1.5 text-xs"
                disabled={downloading}
                onClick={() => setDownloadMenu((open) => !open)}
                aria-label="Download in another aspect ratio"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
            {downloadMenu ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDownloadMenu(false)} />
                <div className="panel-enter absolute right-0 z-20 mt-1 w-52 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 shadow-[0_16px_40px_rgba(0,0,0,0.4)]">
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Download all as…
                  </p>
                  {ASPECT_RATIO_LIST.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => void downloadAll(entry.id)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-white transition hover:bg-white/8"
                    >
                      <span>
                        {entry.label} <span className="text-[var(--muted-foreground)]">· {entry.ratio}</span>
                      </span>
                      <span className="text-[10px] text-[var(--muted-foreground)]">{entry.badge}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <Button variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs" onClick={() => setScheduleOpen(true)}>
            <CalendarClock className="h-3.5 w-3.5" /> Schedule
          </Button>
          <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => void remove()} aria-label="Delete carousel">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            className="group relative shrink-0"
            style={{ width: previewWidth }}
            onDoubleClick={() => setEditor({ index, mode: "preview" })}
          >
            <canvas
              ref={(element) => {
                previewRefs.current[index] = element;
              }}
              width={previewWidth}
              height={previewHeight}
              style={{ width: previewWidth, height: previewHeight }}
              className="cursor-zoom-in rounded-lg border border-[var(--border)] transition group-hover:border-[var(--accent)]/60"
              title={slide.heading || `Slide ${index + 1}`}
            />
            {/* Hover actions: Preview / Edit */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center gap-1.5 rounded-b-lg bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditor({ index, mode: "preview" });
                }}
                className="pointer-events-auto inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] font-medium text-[#fff] backdrop-blur transition hover:bg-black/80"
              >
                <Eye className="h-3 w-3" /> Preview
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditor({ index, mode: "edit" });
                }}
                className="pointer-events-auto inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/90 px-2 py-1 text-[10px] font-medium text-[var(--accent-contrast)] backdrop-blur transition hover:bg-[var(--accent)]"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {editor ? (
        <SlideEditor
          slides={slides}
          ratio={ratio}
          index={editor.index}
          mode={editor.mode}
          saving={saving}
          onSave={saveSlides}
          onClose={() => setEditor(null)}
        />
      ) : null}

      <ScheduleModal
        open={scheduleOpen}
        carouselTitle={carousel.title}
        saving={saving}
        onClose={() => setScheduleOpen(false)}
        onCreate={createSchedule}
      />
    </Card>
  );
}
