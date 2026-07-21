"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Images, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Carousel, CarouselSlide } from "@/types/domain";

/**
 * Carousels: turn a script or a long-form video's transcript into a swipeable
 * Instagram carousel. The copy is generated server-side; the 1080x1350 PNGs
 * are drawn right here on a canvas and downloaded — no image tooling needed.
 */

const SLIDE_W = 1080;
const SLIDE_H = 1350;

type LongformListItem = { id: string; name: string; status: string; transcript?: unknown[] };

/** Draws one slide in the channel look and returns the canvas. */
function drawSlide(slide: CarouselSlide, index: number, total: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_W;
  canvas.height = SLIDE_H;
  const ctx = canvas.getContext("2d")!;

  // Background: deep navy-black gradient with a violet glow — matches the app brand.
  const bg = ctx.createLinearGradient(0, 0, SLIDE_W, SLIDE_H);
  bg.addColorStop(0, "#0b0b14");
  bg.addColorStop(1, "#151329");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  const glow = ctx.createRadialGradient(SLIDE_W * 0.85, SLIDE_H * 0.1, 50, SLIDE_W * 0.85, SLIDE_H * 0.1, 700);
  glow.addColorStop(0, "rgba(124,58,237,0.35)");
  glow.addColorStop(1, "rgba(124,58,237,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);

  // Slide counter.
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "600 34px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${index + 1}/${total}`, SLIDE_W - 70, 100);

  const wrap = (text: string, font: string, maxWidth: number): string[] => {
    ctx.font = font;
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const isHook = index === 0;
  const headingFont = `800 ${isHook ? 92 : 72}px system-ui, -apple-system, sans-serif`;
  const bodyFont = "400 44px system-ui, -apple-system, sans-serif";
  const maxWidth = SLIDE_W - 160;

  const headingLines = slide.heading ? wrap(slide.heading, headingFont, maxWidth) : [];
  const bodyLines = slide.body ? wrap(slide.body, bodyFont, maxWidth) : [];
  const headingLineH = isHook ? 108 : 86;
  const bodyLineH = 62;
  const blockH = headingLines.length * headingLineH + (bodyLines.length ? 40 + bodyLines.length * bodyLineH : 0);
  let y = (SLIDE_H - blockH) / 2 + (isHook ? 70 : 50);

  ctx.textAlign = "left";
  ctx.font = headingFont;
  ctx.fillStyle = "#ffffff";
  for (const line of headingLines) {
    ctx.fillText(line, 80, y);
    y += headingLineH;
  }
  if (bodyLines.length) {
    y += 40;
    ctx.font = bodyFont;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    for (const line of bodyLines) {
      ctx.fillText(line, 80, y);
      y += bodyLineH;
    }
  }

  // Accent bar + handle footer.
  ctx.fillStyle = "#7c3aed";
  ctx.fillRect(80, SLIDE_H - 150, 90, 8);
  ctx.font = "600 36px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText("@nic21vdw", 80, SLIDE_H - 84);

  return canvas;
}

async function downloadSlide(slide: CarouselSlide, index: number, total: number, baseName: string) {
  const canvas = drawSlide(slide, index, total);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("canvas export failed");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${baseName}-slide-${String(index + 1).padStart(2, "0")}.png`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CarouselsPage() {
  const { data, loading, refresh } = useAppData();
  const carousels = useMemo(() => data.videoStudio?.carousels ?? [], [data.videoStudio]);
  const scripts = useMemo(() => data.videoStudio?.scripts ?? [], [data.videoStudio]);

  const [projects, setProjects] = useState<LongformListItem[]>([]);
  const [sourceType, setSourceType] = useState<"script" | "longform" | "custom">("script");
  const [sourceId, setSourceId] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customText, setCustomText] = useState("");
  const [slideCount, setSlideCount] = useState(8);
  const [generating, setGenerating] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/longform/projects", { cache: "no-store" })
      .then((response) => response.json())
      .then((json: { projects?: LongformListItem[] }) => setProjects((json.projects ?? []).filter((p) => p.status === "ready")))
      .catch(() => undefined);
  }, []);

  const generate = async () => {
    const body: Record<string, unknown> = { slideCount };
    if (sourceType === "script") {
      if (!sourceId) return void toast.error("Pick a script first.");
      body.scriptId = sourceId;
    } else if (sourceType === "longform") {
      if (!sourceId) return void toast.error("Pick a long-form project first.");
      body.longformId = sourceId;
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
      const json = (await response.json()) as { carousel?: Carousel; reason?: string | null; error?: string };
      if (!response.ok || !json.carousel) {
        toast.error(json.error ?? "Could not generate the carousel.");
        return;
      }
      setReason(json.reason ?? null);
      toast.success(`Carousel written — ${json.carousel.slides.length} slides.`);
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
        title="Instagram Carousels"
        description="Turn a script or a finished video's transcript into a swipeable carousel — hook slide, value slides, CTA slide — rendered as 1080×1350 images ready to post."
      />

      <Card className="mb-6 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr_120px_auto]">
          <Select
            value={sourceType}
            onChange={(event) => {
              setSourceType(event.target.value as typeof sourceType);
              setSourceId("");
            }}
          >
            <option value="script">From script</option>
            <option value="longform">From video</option>
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
          ) : (
            <Input placeholder="Carousel title" value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} />
          )}

          <Select value={slideCount} onChange={(event) => setSlideCount(Number(event.target.value))}>
            {[4, 5, 6, 7, 8, 9, 10].map((count) => (
              <option key={count} value={count}>
                {count} slides
              </option>
            ))}
          </Select>

          <Button onClick={() => void generate()} disabled={generating} className="shrink-0">
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generating ? "Writing…" : "Generate"}
          </Button>
        </div>
        {sourceType === "custom" ? (
          <Textarea
            placeholder="Paste the content to turn into slides…"
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
          />
        ) : null}
      </Card>

      {reason ? (
        <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">{reason}</div>
      ) : null}

      {carousels.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Images className="h-8 w-8 text-[var(--accent)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {loading ? "Loading…" : "No carousels yet — generate one from a script, a video, or pasted text."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {carousels.map((carousel) => (
            <CarouselCard key={carousel.id} carousel={carousel} refresh={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function CarouselCard({ carousel, refresh }: { carousel: Carousel; refresh: () => Promise<void> | void }) {
  const [downloading, setDownloading] = useState(false);
  const previewRefs = useRef<Array<HTMLCanvasElement | null>>([]);

  // Draw the small previews once the card mounts.
  useEffect(() => {
    carousel.slides.forEach((slide, index) => {
      const target = previewRefs.current[index];
      if (!target) return;
      const full = drawSlide(slide, index, carousel.slides.length);
      const ctx = target.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(full, 0, 0, target.width, target.height);
    });
  }, [carousel]);

  const downloadAll = useCallback(async () => {
    setDownloading(true);
    try {
      const base = carousel.title.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").toLowerCase().slice(0, 40) || "carousel";
      for (let index = 0; index < carousel.slides.length; index += 1) {
        await downloadSlide(carousel.slides[index], index, carousel.slides.length, base);
        // Small gap so the browser doesn't swallow rapid consecutive downloads.
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      toast.success("All slides downloaded — post them in order.");
    } catch {
      toast.error("Could not render the slides.");
    } finally {
      setDownloading(false);
    }
  }, [carousel]);

  const remove = async () => {
    if (!window.confirm("Delete this carousel?")) return;
    const response = await fetch(`/api/studio/carousels/${carousel.id}`, { method: "DELETE" });
    if (response.ok) void refresh();
    else toast.error("Could not delete the carousel.");
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">{carousel.title}</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            {carousel.slides.length} slides · from {carousel.sourceType} · {new Date(carousel.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge>1080×1350</Badge>
          <Button className="gap-1.5 px-3 py-1.5 text-xs" disabled={downloading} onClick={() => void downloadAll()}>
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download all
          </Button>
          <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => void remove()}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {carousel.slides.map((slide, index) => (
          <canvas
            key={slide.id}
            ref={(element) => {
              previewRefs.current[index] = element;
            }}
            width={216}
            height={270}
            className="h-[270px] w-[216px] shrink-0 rounded-lg border border-[var(--border)]"
            title={slide.heading}
          />
        ))}
      </div>
    </Card>
  );
}
