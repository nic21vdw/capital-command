"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NextImage from "next/image";
import { Camera, Check, Copy, Download, ImagePlus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adCanvasSize, fitCover, type VisualAdFormat } from "@/lib/pipeline/visual-brief";
import type { PipelineRunOverview } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";

type VisualMoment = NonNullable<PipelineRunOverview["visualMoment"]>;

const FORMATS: VisualAdFormat[] = ["portrait", "story", "square", "landscape"];

function formatTimestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the selected image."));
    image.src = src;
  });
}

function wrapHeadline(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (context.measureText(test).width <= maxWidth || !line) {
      line = test;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.join(" ").split(/\s+/).length < words.length) {
    lines[lines.length - 1] = `${lines.at(-1)?.replace(/[.,;:!?]+$/, "") ?? ""}...`;
  }
  return lines;
}

export function VisualAdComposer({
  sourceId,
  streamName,
  moment
}: {
  sourceId?: string;
  streamName: string;
  moment: VisualMoment;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<VisualAdFormat>("portrait");
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceImage) return;
    const image = await loadImage(sourceImage);
    const { width, height } = adCanvasSize(format);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, width, height);
    const crop = fitCover(image.naturalWidth, image.naturalHeight, width, height);
    context.filter = "contrast(1.05) saturate(0.94)";
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height);
    context.filter = "none";

    const shade = context.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, "rgba(4, 5, 10, 0.12)");
    shade.addColorStop(0.48, "rgba(4, 5, 10, 0.08)");
    shade.addColorStop(1, "rgba(4, 5, 10, 0.94)");
    context.fillStyle = shade;
    context.fillRect(0, 0, width, height);

    const sideShade = context.createLinearGradient(0, 0, width, 0);
    sideShade.addColorStop(0, "rgba(4, 5, 10, 0.42)");
    sideShade.addColorStop(0.7, "rgba(4, 5, 10, 0)");
    context.fillStyle = sideShade;
    context.fillRect(0, 0, width, height);

    const pad = Math.round(width * 0.07);
    const eyebrowSize = Math.max(24, Math.round(width * 0.025));
    context.fillStyle = "#b69cff";
    context.font = `700 ${eyebrowSize}px Arial, sans-serif`;
    context.letterSpacing = `${Math.max(2, Math.round(width * 0.004))}px`;
    context.fillText("CAPITAL COMMAND  /  LIVE", pad, height - Math.round(height * 0.28));
    context.letterSpacing = "0px";

    const headlineSize = Math.max(54, Math.round(width * (format === "landscape" ? 0.052 : 0.066)));
    context.font = `800 ${headlineSize}px Arial, sans-serif`;
    context.fillStyle = "#ffffff";
    context.textBaseline = "top";
    const lines = wrapHeadline(context, moment.headline, width - pad * 2, format === "story" ? 4 : 3);
    const lineHeight = headlineSize * 1.02;
    const headlineY = height - Math.round(height * 0.23);
    lines.forEach((line, index) => context.fillText(line, pad, headlineY + index * lineHeight));

    context.fillStyle = "rgba(255,255,255,0.72)";
    context.font = `500 ${Math.max(22, Math.round(width * 0.022))}px Arial, sans-serif`;
    context.fillText(streamName.slice(0, 70), pad, height - pad);
  }, [format, moment.headline, sourceImage, streamName]);

  useEffect(() => {
    void render().catch(() => toast.error("Could not render that screenshot."));
  }, [render]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      toast.error("Wait for the livestream preview to load first.");
      return;
    }
    const frame = document.createElement("canvas");
    frame.width = video.videoWidth;
    frame.height = video.videoHeight;
    frame.getContext("2d")?.drawImage(video, 0, 0);
    setSourceImage(frame.toDataURL("image/jpeg", 0.94));
    toast.success("Current livestream frame added.");
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose a PNG, JPG, or WebP screenshot.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSourceImage(String(reader.result));
    reader.onerror = () => toast.error("Could not read that screenshot.");
    reader.readAsDataURL(file);
  }, []);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceImage) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `capital-command-${format}-visual-ad.png`;
      anchor.click();
      URL.revokeObjectURL(href);
    }, "image/png");
  }, [format, sourceImage]);

  return (
    <div
      className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]"
      tabIndex={0}
      onPaste={(event) => {
        const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
        if (image) handleFile(image);
      }}
    >
      <div className="space-y-3">
        {sourceId && (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-black">
            <video
              ref={videoRef}
              // The media fragment lands the browser on the moment with a range
              // request instead of pulling the file from the top and seeking
              // afterwards — the master here is routinely well over 100 MB.
              src={`/api/clips/sources/${encodeURIComponent(sourceId)}/stream#t=${moment.start.toFixed(2)}`}
              controls
              preload="metadata"
              className="max-h-[440px] w-full object-contain"
              onLoadedMetadata={(event) => {
                event.currentTarget.currentTime = Math.min(moment.start, Math.max(0, event.currentTarget.duration - 0.2));
              }}
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
                  if (!video) return;
                  video.currentTime = moment.start;
                  video.pause();
                }}
              >
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                Best moment {formatTimestamp(moment.start)}
              </Button>
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={captureFrame}>
                Capture current frame
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => uploadRef.current?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Upload screenshot
          </Button>
          <input
            ref={uploadRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) handleFile(file);
            }}
          />
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Capture any frame, upload a livestream screenshot, or paste one while this panel is focused.
        </p>

        <div className="flex flex-wrap gap-1.5">
          {FORMATS.map((candidate) => {
            const size = adCanvasSize(candidate);
            return (
              <button
                type="button"
                key={candidate}
                onClick={() => setFormat(candidate)}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-[11px] transition",
                  candidate === format
                    ? "border-[var(--accent)] bg-white/8 text-white"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                {size.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-black/40">
          {sourceImage ? (
            <canvas ref={canvasRef} className="block h-auto max-h-[440px] w-full object-contain" />
          ) : (
            <div className="relative">
              <NextImage
                src="/references/realistic-stream-ad-reference.png"
                alt="Photorealistic livestream advertising reference"
                width={1120}
                height={1400}
                className="block max-h-[440px] w-full object-contain"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent p-4 pt-16">
                <div className="flex items-center gap-2 text-xs font-semibold text-violet-200">
                  <ImagePlus className="h-4 w-4" />
                  Realistic reference
                </div>
                <p className="mt-1 text-xs text-white/75">Add a real stream frame to build the final ad.</p>
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">Selected hook</p>
          <p className="mt-1 text-sm font-semibold text-white">{moment.headline}</p>
          {moment.transcript && (
            <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
              {moment.transcript}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button className="px-3 py-1.5 text-xs" disabled={!sourceImage} onClick={download}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download PNG
          </Button>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(moment.prompt);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
              toast.success("Photorealistic AI prompt copied.");
            }}
          >
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy AI prompt"}
          </Button>
        </div>

        <details className="rounded-lg border border-[var(--border)] bg-white/3 p-3">
          <summary className="cursor-pointer text-xs font-medium text-white">Photorealistic generation prompt</summary>
          <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {moment.prompt}
          </pre>
        </details>
      </div>
    </div>
  );
}
