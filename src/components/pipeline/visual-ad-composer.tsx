"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NextImage from "next/image";
import { Camera, Check, Copy, Download, ImagePlus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adCanvasSize,
  realisticImagePrompt,
  type VisualAdFormat,
} from "@/lib/pipeline/visual-brief";
import {
  defaultVisualAdSettings,
  renderVisualAd,
  type VisualAdSettings,
} from "@/lib/pipeline/visual-ad-render";
import {
  loadVisualAdDraft,
  saveVisualAdDraft,
  visualAdDraftId,
  type StoredVisualAdDraft,
  type VisualAdSource,
} from "@/lib/pipeline/visual-ad-drafts";
import type { PipelineRunOverview } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";

type VisualMoment = NonNullable<PipelineRunOverview["visualMoment"]>;
type RenderVerdict = { warnings: string[]; copyFits: boolean };

const FORMATS: VisualAdFormat[] = ["portrait", "story", "square", "landscape"];
const FILE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function formatTimestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const sec = String(whole % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${sec}`
    : `${minutes}:${sec}`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Could not load the selected image."));
    image.src = src;
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

export function VisualAdComposer(props: {
  sourceId?: string;
  streamName: string;
  moment: VisualMoment;
}) {
  return (
    <VisualAdDraft
      key={visualAdDraftId(
        props.sourceId,
        props.streamName,
        props.moment.start,
      )}
      {...props}
    />
  );
}

function VisualAdDraft({
  sourceId,
  streamName,
  moment,
}: {
  sourceId?: string;
  streamName: string;
  moment: VisualMoment;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const retouchRef = useRef<HTMLInputElement>(null);
  const autoCaptured = useRef(false);
  const restoring = useRef(true);
  const rendering = useRef(0);
  const importing = useRef(0);
  const exporting = useRef(false);
  const pendingDraft = useRef<StoredVisualAdDraft | null>(null);
  const [settings, setSettings] = useState(() =>
    defaultVisualAdSettings(moment.headline),
  );
  const [original, setOriginal] = useState<VisualAdSource | null>(null);
  const [retouched, setRetouched] = useState<VisualAdSource | null>(null);
  const [useRetouched, setUseRetouched] = useState(false);
  const [identityReviewed, setIdentityReviewed] = useState(false);
  const [verdict, setVerdict] = useState<RenderVerdict | null>(null);
  const [copied, setCopied] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [storageStatus, setStorageStatus] = useState(
    "Restoring saved draft...",
  );
  const [busy, setBusy] = useState(false);
  const sourceImage = useRetouched && retouched ? retouched : original;
  const [rendered, setRendered] = useState<{
    source: VisualAdSource;
    settings: VisualAdSettings;
  } | null>(null);
  const draftId = visualAdDraftId(sourceId, streamName, moment.start);
  const prompt = realisticImagePrompt(
    { ...moment, headline: settings.headline },
    streamName,
  );

  const update = <K extends keyof VisualAdSettings>(
    key: K,
    value: VisualAdSettings[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const captureFrame = useCallback(
    (automatic = false) => {
      const video = videoRef.current;
      if (automatic && restoring.current) return;
      if (
        !video ||
        !video.videoWidth ||
        !video.videoHeight ||
        video.readyState < 2 ||
        video.seeking
      ) {
        if (!automatic)
          toast.error("Wait for the selected frame to finish loading first.");
        return;
      }
      try {
        const frame = document.createElement("canvas");
        frame.width = video.videoWidth;
        frame.height = video.videoHeight;
        const context = frame.getContext("2d");
        if (!context)
          throw new Error("The browser could not capture this frame.");
        context.drawImage(video, 0, 0);
        setOriginal({
          src: frame.toDataURL("image/png"),
          width: frame.width,
          height: frame.height,
          origin: "stream-frame",
          name: `${streamName} at ${formatTimestamp(video.currentTime)}`,
          capturedAt: new Date().toISOString(),
          sourceTime: video.currentTime,
        });
        setRetouched(null);
        setUseRetouched(false);
        setIdentityReviewed(false);
        setSourceError(null);
        setBusy(false);
        autoCaptured.current = true;
        importing.current++;
        if (!automatic)
          toast.success(
            "Original stream frame captured at full source resolution.",
          );
      } catch (error) {
        setSourceError(
          error instanceof Error
            ? error.message
            : "Could not capture this stream frame. Upload an original photo instead.",
        );
      }
    },
    [streamName],
  );

  useEffect(() => {
    let active = true;
    void loadVisualAdDraft(draftId)
      .then((saved) => {
        if (!active || autoCaptured.current) return;
        if (saved) {
          setSettings(saved.settings);
          setOriginal(saved.original);
          setRetouched(saved.retouched);
          setUseRetouched(saved.useRetouched);
          setIdentityReviewed(saved.identityReviewed);
          autoCaptured.current = true;
        }
        setStorageStatus(
          saved
            ? "Saved draft restored on this browser."
            : "Drafts save on this browser after you add an image.",
        );
      })
      .catch((error: unknown) => {
        if (active)
          setStorageStatus(
            error instanceof Error
              ? error.message
              : "Local draft storage is unavailable.",
          );
      })
      .finally(() => {
        if (!active) return;
        restoring.current = false;
        if (!autoCaptured.current) captureFrame(true);
      });
    return () => {
      active = false;
    };
  }, [draftId, captureFrame]);

  useEffect(() => {
    if (!original || restoring.current) return;
    let active = true;
    const draft = {
      id: draftId,
      updatedAt: Date.now(),
      settings,
      original,
      retouched,
      useRetouched,
      identityReviewed,
    };
    pendingDraft.current = draft;
    const timer = setTimeout(() => {
      void saveVisualAdDraft(draft)
        .then(() => {
          if (pendingDraft.current === draft) pendingDraft.current = null;
          if (active)
            setStorageStatus(
              "Draft saved on this browser. The six most recent drafts are kept within a 48 MB limit.",
            );
        })
        .catch((error: unknown) => {
          if (active)
            setStorageStatus(
              error instanceof Error
                ? error.message
                : "Could not save this draft. Download it before leaving.",
            );
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draftId, settings, original, retouched, useRetouched, identityReviewed]);

  useEffect(() => {
    return () => {
      const draft = pendingDraft.current;
      if (draft) void saveVisualAdDraft(draft).catch(() => undefined);
    };
  }, [draftId]);

  useEffect(() => {
    if (!sourceImage) return;
    const request = ++rendering.current;
    let active = true;
    const source = sourceImage;
    void loadImage(source.src)
      .then((image) => {
        if (!active || request !== rendering.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const size = adCanvasSize(settings.format);
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error("The browser could not create the ad canvas.");
        const result = renderVisualAd(context, image, source, settings);
        setVerdict(result);
        setRenderError(null);
        setRendered({ source, settings });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRendered(null);
        setRenderError(
          error instanceof Error
            ? error.message
            : "Could not render that image.",
        );
      });
    return () => {
      active = false;
    };
  }, [settings, sourceImage]);

  const handleFile = useCallback(
    async (file: File, enhanced = false) => {
      if (!FILE_TYPES.has(file.type)) {
        toast.error("Choose a PNG, JPG, or WebP photo.");
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast.error("Use an image smaller than 25 MB.");
        return;
      }
      if (enhanced && !original) {
        toast.error(
          "Add the original photo before importing a retouch for comparison.",
        );
        return;
      }
      const request = ++importing.current;
      setBusy(true);
      try {
        const src = await readFile(file);
        const image = await loadImage(src);
        if (request !== importing.current) return;
        const next: VisualAdSource = {
          src,
          width: image.naturalWidth,
          height: image.naturalHeight,
          origin: enhanced ? "retouched-import" : "upload",
          name: file.name,
          capturedAt: new Date().toISOString(),
        };
        if (enhanced) {
          setRetouched(next);
          setUseRetouched(true);
        } else {
          setOriginal(next);
          setRetouched(null);
          setUseRetouched(false);
          autoCaptured.current = true;
        }
        setIdentityReviewed(false);
        setSourceError(null);
      } catch (error) {
        if (request === importing.current)
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not load that photo.",
          );
      } finally {
        if (request === importing.current) setBusy(false);
      }
    },
    [original],
  );

  const previewCurrent =
    rendered?.source === sourceImage && rendered?.settings === settings;
  const canExport = Boolean(
    sourceImage &&
    previewCurrent &&
    verdict?.copyFits &&
    !renderError &&
    (!useRetouched || identityReviewed),
  );
  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canExport || exporting.current) return;
    exporting.current = true;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    try {
      const context = exportCanvas.getContext("2d");
      if (!context)
        throw new Error("The browser could not prepare the export.");
      context.drawImage(canvas, 0, 0);
      exportCanvas.toBlob((blob) => {
        exporting.current = false;
        if (!blob) {
          toast.error(
            "The browser could not export this ad. Try a local PNG or JPG source.",
          );
          return;
        }
        downloadBlob(blob, `nic-stream-ad-${settings.format}.png`);
        toast.success("Draft PNG downloaded.");
      }, "image/png");
    } catch (error) {
      exporting.current = false;
      toast.error(
        error instanceof Error ? error.message : "Could not export that ad.",
      );
    }
  }, [canExport, settings.format]);

  const downloadReview = () => {
    if (!sourceImage || !previewCurrent) return;
    const review = {
      status: "draft",
      streamName,
      sourceId,
      selectedMoment: {
        start: moment.start,
        end: moment.end,
        transcript: moment.transcript,
      },
      original: original ? { ...original, src: undefined } : undefined,
      retouched:
        useRetouched && retouched
          ? { ...retouched, src: undefined }
          : undefined,
      settings,
      identityReview: useRetouched
        ? identityReviewed
          ? "User compared retouch with original"
          : "Retouch still needs comparison with original"
        : "Original source pixels, no generative edits by this composer",
      warnings: verdict?.warnings,
      exportedAt: new Date().toISOString(),
    };
    downloadBlob(
      new Blob([JSON.stringify(review, null, 2)], { type: "application/json" }),
      `nic-stream-ad-${settings.format}.review.json`,
    );
  };

  return (
    <div
      className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]"
      tabIndex={0}
      onPaste={(event) => {
        const image = Array.from(event.clipboardData.files).find((file) =>
          FILE_TYPES.has(file.type),
        );
        if (image) void handleFile(image);
      }}
    >
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-white">
            Your footage, your actual likeness
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            The selected real frame loads automatically. Copy stays in a
            separate band so your face, hands and screen remain visible.
          </p>
        </div>
        {sourceId && (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-black">
            <video
              ref={videoRef}
              src={`/api/clips/sources/${encodeURIComponent(sourceId)}/stream#t=${moment.start.toFixed(2)}`}
              controls
              preload="metadata"
              className="max-h-[340px] w-full object-contain"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (Number.isFinite(video.duration))
                  video.currentTime = Math.min(
                    moment.start,
                    Math.max(0, video.duration - 0.2),
                  );
              }}
              onLoadedData={(event) => {
                if (
                  !autoCaptured.current &&
                  Math.abs(event.currentTarget.currentTime - moment.start) < 0.3
                )
                  captureFrame(true);
              }}
              onSeeked={() => {
                if (!autoCaptured.current) captureFrame(true);
              }}
              onError={() =>
                setSourceError(
                  "The original stream preview could not load. Upload a real screenshot or photo to continue.",
                )
              }
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {sourceId && (
            <>
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => {
                  const video = videoRef.current;
                  if (video) {
                    video.currentTime = moment.start;
                    video.pause();
                  }
                }}
              >
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                Selected moment {formatTimestamp(moment.start)}
              </Button>
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                disabled={busy}
                onClick={() => captureFrame()}
              >
                Capture current frame
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={() => uploadRef.current?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Upload original photo
          </Button>
          <input
            ref={uploadRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            aria-label="Upload original photo"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleFile(file);
            }}
          />
        </div>
        {sourceError && (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {sourceError}
          </p>
        )}
        <p className="text-[11px] text-[var(--muted-foreground)]">
          You can also paste an original photo into this panel. Uploaded photos
          are processed in your browser.
        </p>
        <div className="flex flex-wrap gap-1.5" aria-label="Ad format">
          {FORMATS.map((format) => (
            <button
              type="button"
              key={format}
              aria-pressed={format === settings.format}
              onClick={() => update("format", format)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-[11px] transition",
                format === settings.format
                  ? "border-[var(--accent)] bg-white/8 text-white"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white",
              )}
            >
              {adCanvasSize(format).label}
            </button>
          ))}
        </div>
        <label className="block text-xs text-[var(--muted-foreground)]">
          Headline
          <Input
            value={settings.headline}
            maxLength={180}
            className="mt-1"
            onChange={(event) => update("headline", event.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-[var(--muted-foreground)]">
            Creator or brand
            <Input
              value={settings.brand}
              maxLength={70}
              className="mt-1"
              onChange={(event) => update("brand", event.target.value)}
            />
          </label>
          <label className="block text-xs text-[var(--muted-foreground)]">
            Call to action
            <Input
              value={settings.callToAction}
              maxLength={90}
              className="mt-1"
              onChange={(event) => update("callToAction", event.target.value)}
            />
          </label>
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Keep claims tied to what the stream actually shows. The original hook
          is: {moment.headline}
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--muted-foreground)]">
          <label className="flex items-center gap-2">
            Framing
            <select
              value={settings.framing}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1.5 text-white"
              onChange={(event) => {
                const framing = event.target
                  .value as VisualAdSettings["framing"];
                setSettings((current) => ({
                  ...current,
                  framing,
                  focusX: framing === "facecam" ? 1 : 0.5,
                  focusY: framing === "facecam" ? 0 : 0.5,
                }));
              }}
            >
              <option value="complete">Complete frame</option>
              <option value="facecam">Top-right facecam</option>
              <option value="crop">Crop with focus</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Photo treatment
            <select
              value={settings.treatment}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1.5 text-white"
              onChange={(event) =>
                update(
                  "treatment",
                  event.target.value as VisualAdSettings["treatment"],
                )
              }
            >
              <option value="original">Original pixels</option>
              <option value="natural">Subtle exposure and colour</option>
            </select>
          </label>
        </div>
        {settings.framing !== "complete" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-[var(--muted-foreground)]">
              Horizontal focus
              <input
                className="mt-1 block w-full"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.focusX}
                onChange={(event) =>
                  update("focusX", Number(event.target.value))
                }
              />
            </label>
            <label className="text-xs text-[var(--muted-foreground)]">
              Vertical focus
              <input
                className="mt-1 block w-full"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.focusY}
                onChange={(event) =>
                  update("focusY", Number(event.target.value))
                }
              />
            </label>
          </div>
        )}
        {original && (
          <details
            className="rounded-lg border border-[var(--border)] p-3"
            open={Boolean(retouched)}
          >
            <summary className="cursor-pointer text-xs font-medium text-white">
              Original reference and optional retouch
            </summary>
            <NextImage
              src={original.src}
              alt="Original source for comparing Nic's face and the actual screen"
              width={original.width}
              height={original.height}
              unoptimized
              className="mt-3 h-auto max-h-64 w-full object-contain"
            />
            <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
              {original.name} | {original.width} x {original.height}
              {original.sourceTime !== undefined
                ? ` | ${formatTimestamp(original.sourceTime)}`
                : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => {
                  const anchor = document.createElement("a");
                  anchor.href = original.src;
                  anchor.download = `nic-stream-original.${original.src.startsWith("data:image/jpeg") ? "jpg" : original.src.startsWith("data:image/webp") ? "webp" : "png"}`;
                  anchor.click();
                }}
              >
                Download original reference
              </Button>
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                disabled={busy}
                onClick={() => retouchRef.current?.click()}
              >
                Import retouched version
              </Button>
              <input
                ref={retouchRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                aria-label="Import retouched version"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handleFile(file, true);
                }}
              />
            </div>
            <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
              Attach the original when using the retouch brief. A generated face
              can drift; compare any imported edit with this original.
            </p>
            {retouched && (
              <div className="mt-3 space-y-2">
                <label className="flex items-center gap-2 text-xs text-white">
                  <input
                    type="checkbox"
                    checked={useRetouched}
                    onChange={(event) => setUseRetouched(event.target.checked)}
                  />
                  Use imported retouch in the ad
                </label>
                {useRetouched && (
                  <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
                    <input
                      className="mt-0.5"
                      type="checkbox"
                      checked={identityReviewed}
                      onChange={(event) =>
                        setIdentityReviewed(event.target.checked)
                      }
                    />
                    I compared the face, hands and screen with the original and
                    they still look accurate.
                  </label>
                )}
              </div>
            )}
          </details>
        )}
      </div>
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[#0c1018]">
          {sourceImage ? (
            <canvas
              ref={canvasRef}
              aria-label="Draft ad preview using the selected real photo"
              className="block h-auto max-h-[620px] w-full object-contain"
            />
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center">
              <ImagePlus className="h-8 w-8 text-[var(--accent)]" />
              <p className="text-sm font-semibold text-white">
                Start with the real frame
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {sourceId
                  ? "Loading your selected livestream moment. You can also upload an original photo."
                  : "Upload a real photo or screenshot to build the draft ad."}
              </p>
            </div>
          )}
        </div>
        {renderError && (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {renderError}
          </p>
        )}
        {sourceImage && (
          <div className="rounded-lg border border-[var(--border)] p-3 text-xs">
            <p className="font-semibold text-white">Draft quality review</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              {sourceImage.width} x {sourceImage.height} source |{" "}
              {adCanvasSize(settings.format).width} x{" "}
              {adCanvasSize(settings.format).height} export
            </p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              {useRetouched
                ? "Imported retouch selected. Verify likeness against the original on the left."
                : settings.framing === "complete"
                  ? "Complete source frame preserved. No generated face or invented product details."
                  : "Original source with a manual crop. Check the face and screen are fully visible."}
            </p>
            {!previewCurrent && (
              <p className="mt-1 text-[var(--muted-foreground)]">
                Updating preview...
              </p>
            )}
            {verdict?.warnings.map((warning) => (
              <p key={warning} className="mt-2 text-[var(--warning)]">
                {warning}
              </p>
            ))}
          </div>
        )}
        <p className="text-[11px] text-[var(--muted-foreground)]" role="status">
          {storageStatus}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            className="px-3 py-1.5 text-xs"
            disabled={!canExport}
            onClick={download}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download draft PNG
          </Button>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={!sourceImage || !previewCurrent}
            onClick={downloadReview}
          >
            Download source notes
          </Button>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={!original}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(prompt);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
                toast.success(
                  "Retouch brief copied. Attach the original reference photo.",
                );
              } catch {
                toast.error(
                  "Clipboard access was unavailable. Select the brief below to copy it.",
                );
              }
            }}
          >
            {copied ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy optional retouch brief"}
          </Button>
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Save source notes alongside your PNG for its original frame, time and
          edits. Nothing is posted or scheduled from this composer.
        </p>
        {moment.transcript && (
          <p className="line-clamp-4 text-xs leading-relaxed text-[var(--muted-foreground)]">
            Selected transcript: {moment.transcript}
          </p>
        )}
        <details className="rounded-lg border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-xs font-medium text-white">
            Optional photo retouch brief
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {prompt}
          </pre>
        </details>
      </div>
    </div>
  );
}
