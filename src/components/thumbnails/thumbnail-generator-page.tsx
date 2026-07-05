"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronsDown,
  ChevronsUp,
  Copy,
  CopyPlus,
  Download,
  Eraser,
  FolderOpen,
  ImagePlus,
  Layers,
  Link2,
  Link2Off,
  Lock,
  MousePointer2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Unlock,
  X
} from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { BACKGROUND_STYLES, getStyle } from "@/lib/thumbnails/backgrounds";
import { removeImageBackground } from "@/lib/thumbnails/bg-removal";
import { appleEmojiUrl, subscribeEmojiLoaded } from "@/lib/thumbnails/emoji";
import { DEFAULT_FONT_ID, ensureFontLoaded, FONT_OPTIONS, getFont, GOOGLE_FONTS_HREF } from "@/lib/thumbnails/fonts";
import {
  buildVariants,
  computeLayout,
  hitTest,
  hitTestHandle,
  IMAGE_BASE_WIDTH,
  renderEditor,
  renderThumbnail,
  renderToDataUrl,
  renderToSizedDataUrl,
  type Corner
} from "@/lib/thumbnails/render";
import { overlayIdeas, titleTreatments } from "@/lib/thumbnails/suggestions";
import {
  DEFAULT_TEXT_TRANSFORM,
  DEFAULT_TREATMENT,
  defaultImageTransform,
  effectiveOpacity,
  effectiveScaleY,
  MAX_IMAGES,
  type BackgroundStyleId,
  type ImageLayer,
  type ImageTreatment,
  type Intensity,
  type Sticker,
  type StickerType,
  type TextEmphasis,
  type TextPosition,
  type TextSize,
  type ThumbnailOptions,
  type Transform
} from "@/lib/thumbnails/types";
import { cn } from "@/lib/utils";
import type { SavedThumbnail } from "@/types/domain";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

type Variant = { label: string; png: string; jpeg: string };
type MoveTarget = "image" | "text";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Serialize a layer image to a PNG data URL so it survives a save/reload. */
function imageToDataUrl(image: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Decode a data URL back into an HTMLImageElement. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

/** Highest numeric suffix in a list of ids like `img-3` / `sticker-7`. */
function maxIdSuffix(ids: string[]): number {
  return ids.reduce((max, id) => {
    const n = Number(id.split("-").pop());
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Clipboard access was blocked by the browser.");
  }
}

/** Wrap any degree value into the (-180, 180] range. */
function normalizeAngle(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** Sticker layer ids are minted as `sticker-N` (see addSticker). */
function isStickerId(id: string) {
  return id.startsWith("sticker-");
}

let layerCounter = 0;
function nextLayerId() {
  layerCounter += 1;
  return `img-${layerCounter}`;
}

function makeLayer(name: string, image: HTMLImageElement, index: number): ImageLayer {
  return { id: nextLayerId(), name, image, transform: defaultImageTransform(index), treatment: { ...DEFAULT_TREATMENT } };
}

const STICKER_PRESETS: { type: StickerType; label: string; defaults: Partial<Sticker> }[] = [
  { type: "circle", label: "Circle", defaults: { color: "#ff2d2d" } },
  { type: "arrow", label: "Arrow", defaults: { color: "#ff2d2d" } },
  { type: "emoji", label: "Emoji", defaults: { text: "🔥" } },
  { type: "badge", label: "Badge", defaults: { color: "#ffd34d", text: "$10K" } }
];

const EMOJI_CHOICES = ["🔥", "😱", "💰", "✅", "❌", "🤯", "👀", "💀", "⚡", "🚀"];

/** A compact labelled range slider matching the app's dark styling. */
function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span className="uppercase tracking-wide">{label}</span>
        <span className="text-white">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--accent)]"
      />
    </label>
  );
}

/** A compact numeric input with a label, used for precise transform editing. */
function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</span>
      <div className="flex items-center rounded-lg border border-white/10 bg-black/20 focus-within:border-[var(--accent)]">
        <input
          type="number"
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className="h-9 w-full bg-transparent px-2 text-sm text-white outline-none disabled:opacity-50"
        />
        {suffix ? <span className="pr-2 text-xs text-[var(--muted-foreground)]">{suffix}</span> : null}
      </div>
    </label>
  );
}

/** Small square icon button used in the selected-layer toolbar. */
function ToolButton({
  title,
  onClick,
  disabled,
  active,
  danger,
  children
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg border text-[var(--muted-foreground)] transition disabled:opacity-30",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
          : danger
            ? "border-white/10 bg-white/5 hover:border-red-500/40 hover:bg-red-500/15 hover:text-red-300"
            : "border-white/10 bg-white/5 hover:border-white/30 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

/** A small pill reflecting the current save state. */
function SaveStatusBadge({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { label: string; className: string }> = {
    idle: { label: "Not saved", className: "border-white/10 bg-white/5 text-[var(--muted-foreground)]" },
    unsaved: { label: "Unsaved changes", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
    saving: { label: "Saving…", className: "border-sky-400/30 bg-sky-400/10 text-sky-200" },
    saved: { label: "Saved", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
    error: { label: "Save failed", className: "border-red-500/40 bg-red-500/15 text-red-200" }
  };
  const { label, className } = map[status];
  return <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium", className)}>{label}</span>;
}

export function ThumbnailGeneratorPage() {
  const previewRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickerSeq = useRef(0);

  const [images, setImages] = useState<ImageLayer[]>([]);
  const [title, setTitle] = useState("");
  const [overlayText, setOverlayText] = useState("");
  const [styleId, setStyleId] = useState<BackgroundStyleId>("gradient");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [intensity, setIntensity] = useState<Intensity>("balanced");
  const [emphasis, setEmphasis] = useState<TextEmphasis>("outline");
  const [position, setPosition] = useState<TextPosition>("left");
  const [size, setSize] = useState<TextSize>("medium");
  const [uppercase, setUppercase] = useState(true);

  // Text styling
  const [fontId, setFontId] = useState(DEFAULT_FONT_ID);
  const [textColor, setTextColor] = useState("auto");
  const [highlightColor, setHighlightColor] = useState("#ffd34d");

  // Layout / placement
  const [textTransform, setTextTransform] = useState<Transform>(DEFAULT_TEXT_TRANSFORM);
  const [manualLayout, setManualLayout] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Subject background removal
  const [removingBg, setRemovingBg] = useState(false);
  const [bgTolerance, setBgTolerance] = useState(32);

  // Call-outs + export
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [exportScale, setExportScale] = useState(1);
  const [exportWidth, setExportWidth] = useState(1280);
  const [exportHeight, setExportHeight] = useState(720);
  const [exportFormat, setExportFormat] = useState<"png" | "jpeg">("png");
  const [smallPreview, setSmallPreview] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);

  // Bumped once a networked font has finished loading, to force a re-render.
  const [fontTick, setFontTick] = useState(0);

  // Saved thumbnail projects (persisted in the app data store).
  const { data, mutate } = useAppData();
  const savedThumbnails = data.savedThumbnails;
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingSavedId, setLoadingSavedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [autosave, setAutosave] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const style = getStyle(styleId);
  const options: ThumbnailOptions = useMemo(
    () => ({
      images,
      text: overlayText,
      textTransform,
      manualLayout,
      style: styleId,
      paletteIndex,
      intensity,
      emphasis,
      position,
      size,
      uppercase,
      fontId,
      textColor,
      highlightColor,
      stickers
    }),
    [images, overlayText, textTransform, manualLayout, styleId, paletteIndex, intensity, emphasis, position, size, uppercase, fontId, textColor, highlightColor, stickers]
  );

  // Keep the latest options/images available to handlers without re-binding.
  const optionsRef = useRef(options);
  const imagesRef = useRef(images);
  useEffect(() => {
    optionsRef.current = options;
    imagesRef.current = images;
  }, [options, images]);

  // Load the Google Fonts stylesheet once so display faces are available.
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById("thumb-google-fonts")) return;
    const link = document.createElement("link");
    link.id = "thumb-google-fonts";
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_HREF;
    document.head.appendChild(link);
  }, []);

  // Re-render once an Apple emoji image finishes loading (the canvas falls back
  // to the native emoji font until then).
  useEffect(() => subscribeEmojiLoaded(() => setFontTick((n) => n + 1)), []);

  // Warm up the selected font, then re-render once it's ready (canvas silently
  // falls back to a system face if the font hasn't loaded yet).
  useEffect(() => {
    let cancelled = false;
    void ensureFontLoaded(getFont(fontId)).then(() => {
      if (!cancelled) setFontTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [fontId]);

  // Live preview re-renders on every settings change (with edit chrome when editing).
  useEffect(() => {
    if (!previewRef.current) return;
    if (editing) {
      renderEditor(previewRef.current, options, selectedId);
    } else {
      renderThumbnail(previewRef.current, options);
    }
    try {
      setSmallPreview(previewRef.current.toDataURL("image/jpeg", 0.9));
    } catch {
      // toDataURL throws if the canvas is tainted by a cross-origin asset; keep
      // the last good preview rather than crashing the editor.
    }
  }, [options, editing, selectedId, fontTick]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    const room = MAX_IMAGES - imagesRef.current.length;
    if (room <= 0) {
      toast.error(`You can place up to ${MAX_IMAGES} images.`);
      return;
    }
    if (list.length > room) toast.error(`Only ${room} more image(s) could be added (max ${MAX_IMAGES}).`);
    list.slice(0, room).forEach((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error(`"${file.name}" is not an image. Upload a PNG, JPEG, or WebP.`);
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`"${file.name}" is over 15MB. Export a smaller version and try again.`);
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setImages((existing) => (existing.length >= MAX_IMAGES ? existing : [...existing, makeLayer(file.name, img, existing.length)]));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        toast.error(`The browser could not decode "${file.name}".`);
      };
      img.src = url;
    });
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((current) => current.filter((layer) => layer.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const moveLayer = useCallback((id: string, direction: -1 | 1) => {
    setImages((current) => {
      const index = current.findIndex((layer) => layer.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const moveLayerEdge = useCallback((id: string, edge: "front" | "back") => {
    setImages((current) => {
      const index = current.findIndex((layer) => layer.id === id);
      if (index < 0) return current;
      const next = [...current];
      const [layer] = next.splice(index, 1);
      // Array order is back-to-front, so "front" is the end of the array.
      if (edge === "front") next.push(layer);
      else next.unshift(layer);
      return next;
    });
  }, []);

  const duplicateImage = useCallback((source: ImageLayer) => {
    const copy: ImageLayer = {
      ...source,
      id: nextLayerId(),
      name: `${source.name} copy`,
      // Nudge the duplicate so it's visible against the original's position.
      transform: { ...source.transform, x: clamp(source.transform.x + 0.04, 0, 1), y: clamp(source.transform.y + 0.04, 0, 1) },
      treatment: { ...source.treatment }
    };
    setImages((existing) => {
      const at = existing.findIndex((layer) => layer.id === source.id);
      const next = [...existing];
      next.splice(at < 0 ? existing.length : at + 1, 0, copy);
      return next;
    });
    setSelectedId(copy.id);
  }, []);

  const toggleLock = useCallback((id: string) => {
    setImages((current) => current.map((layer) => (layer.id === id ? { ...layer, locked: !layer.locked } : layer)));
  }, []);

  const toggleAspectLock = useCallback((id: string) => {
    setImages((current) =>
      current.map((layer) => {
        if (layer.id !== id) return layer;
        const willLock = !(layer.lockAspect ?? true);
        // Re-locking aspect collapses height back to proportional with width.
        const transform = willLock ? { ...layer.transform, scaleY: layer.transform.scale } : layer.transform;
        return { ...layer, lockAspect: willLock, transform };
      })
    );
  }, []);

  const resetTransform = useCallback((id: string) => {
    if (id === "text") {
      setTextTransform(DEFAULT_TEXT_TRANSFORM);
      return;
    }
    setImages((current) =>
      current.map((layer, index) =>
        layer.id === id ? { ...layer, transform: defaultImageTransform(index), lockAspect: true } : layer
      )
    );
    toast.success("Transform reset.");
  }, []);

  const updateTransformById = useCallback((id: string, partial: Partial<Transform>) => {
    if (id === "text") {
      setTextTransform((current) => ({ ...current, ...partial }));
    } else if (isStickerId(id)) {
      // Stickers store x/y/scale/rotation as top-level fields (same keys as Transform).
      setStickers((current) => current.map((s) => (s.id === id ? { ...s, ...partial } : s)));
    } else {
      setImages((current) => current.map((layer) => (layer.id === id ? { ...layer, transform: { ...layer.transform, ...partial } } : layer)));
    }
  }, []);

  const updateSelectedTransform = useCallback(
    (partial: Partial<Transform>) => {
      if (selectedId) updateTransformById(selectedId, partial);
    },
    [selectedId, updateTransformById]
  );

  const selectedTransform: Transform | null = useMemo(() => {
    if (selectedId === "text") return textTransform;
    if (selectedId && isStickerId(selectedId)) {
      const sticker = stickers.find((s) => s.id === selectedId);
      return sticker ? { x: sticker.x, y: sticker.y, scale: sticker.scale, rotation: sticker.rotation } : null;
    }
    return images.find((layer) => layer.id === selectedId)?.transform ?? null;
  }, [selectedId, textTransform, images, stickers]);

  // The selected image layer (null when text/sticker/nothing is selected).
  const selectedImage = useMemo(
    () => images.find((layer) => layer.id === selectedId) ?? null,
    [images, selectedId]
  );

  const enterEditMode = useCallback(() => {
    setManualLayout(true);
    setEditing(true);
  }, []);

  // The image whose cut-out treatment the Subject panel edits: the selected
  // image layer, or the first image when text/nothing is selected.
  const activeImage = useMemo(() => {
    const selected = images.find((layer) => layer.id === selectedId);
    return selected ?? images[0] ?? null;
  }, [images, selectedId]);

  const updateTreatment = useCallback((id: string, patch: Partial<ImageTreatment>) => {
    setImages((current) => current.map((layer) => (layer.id === id ? { ...layer, treatment: { ...layer.treatment, ...patch } } : layer)));
  }, []);

  const handleRemoveBackground = async () => {
    if (!activeImage) return;
    const targetId = activeImage.id;
    setRemovingBg(true);
    try {
      const cut = await removeImageBackground(activeImage.image, bgTolerance);
      setImages((current) =>
        current.map((layer) =>
          layer.id === targetId
            ? { ...layer, image: cut, treatment: { ...layer.treatment, cutout: true, stroke: layer.treatment.stroke === 0 ? 10 : layer.treatment.stroke } }
            : layer
        )
      );
      toast.success("Background removed — switched to cut-out mode.");
    } catch {
      toast.error("Could not process that image. Try a higher tolerance.");
    } finally {
      setRemovingBg(false);
    }
  };

  // ----- Interactive dragging / resizing / rotating on the canvas -----
  type DragState =
    | { mode: "move"; id: string; offsetX: number; offsetY: number }
    | {
        mode: "resize";
        id: string;
        corner: Corner;
        startScale: number;
        startScaleY: number;
        startHalfW: number;
        startHalfH: number;
      }
    | { mode: "rotate"; id: string; cx: number; cy: number };
  const dragRef = useRef<DragState | null>(null);

  const pointerToCanvas = (clientX: number, clientY: number) => {
    const canvas = previewRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * canvas.width, y: ((clientY - rect.top) / rect.height) * canvas.height };
  };

  /** Whether a layer is a locked image (locked images can be selected, not moved). */
  const isLocked = (id: string) => imagesRef.current.find((layer) => layer.id === id)?.locked ?? false;

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editing) return;
    const point = pointerToCanvas(event.clientX, event.clientY);
    if (!point) return;
    const canvas = previewRef.current!;
    const layout = computeLayout(optionsRef.current);

    // First, if a layer is already selected, check its resize/rotate handles.
    const selectedBox = layout.find((box) => box.id === selectedId);
    if (selectedBox && !isLocked(selectedBox.id)) {
      const handle = hitTestHandle(selectedBox, point.x, point.y);
      if (handle) {
        canvas.setPointerCapture(event.pointerId);
        if (handle === "rotate") {
          dragRef.current = { mode: "rotate", id: selectedBox.id, cx: selectedBox.cx, cy: selectedBox.cy };
        } else {
          dragRef.current = {
            mode: "resize",
            id: selectedBox.id,
            corner: handle,
            startScale: scaleOf(selectedBox.id),
            startScaleY: scaleYOf(selectedBox.id),
            startHalfW: selectedBox.halfW,
            startHalfH: selectedBox.halfH
          };
        }
        return;
      }
    }

    // Otherwise select / move the topmost layer under the pointer.
    const hit = [...layout].reverse().find((box) => hitTest(box, point.x, point.y));
    if (!hit) {
      setSelectedId(null);
      return;
    }
    setSelectedId(hit.id);
    if (isLocked(hit.id)) return; // selectable but not draggable
    dragRef.current = { mode: "move", id: hit.id, offsetX: point.x / canvas.width - hit.cx / canvas.width, offsetY: point.y / canvas.height - hit.cy / canvas.height };
    canvas.setPointerCapture(event.pointerId);
  };

  /** Current width-scale of any layer kind (text/stickers use a single scale). */
  const scaleOf = (id: string): number => {
    if (id === "text") return optionsRef.current.textTransform.scale;
    if (isStickerId(id)) return stickers.find((s) => s.id === id)?.scale ?? 1;
    return imagesRef.current.find((l) => l.id === id)?.transform.scale ?? 1;
  };
  const scaleYOf = (id: string): number => {
    const layer = imagesRef.current.find((l) => l.id === id);
    return layer ? effectiveScaleY(layer.transform) : scaleOf(id);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!editing || !drag) return;
    const point = pointerToCanvas(event.clientX, event.clientY);
    const canvas = previewRef.current;
    if (!point || !canvas) return;

    if (drag.mode === "move") {
      const x = clamp(point.x / canvas.width - drag.offsetX, 0, 1);
      const y = clamp(point.y / canvas.height - drag.offsetY, 0, 1);
      if (drag.id === "text") {
        setTextTransform((current) => ({ ...current, x, y }));
      } else if (isStickerId(drag.id)) {
        setStickers((current) => current.map((s) => (s.id === drag.id ? { ...s, x, y } : s)));
      } else {
        setImages((current) => current.map((layer) => (layer.id === drag.id ? { ...layer, transform: { ...layer.transform, x, y } } : layer)));
      }
      return;
    }

    if (drag.mode === "rotate") {
      let deg = (Math.atan2(point.y - drag.cy, point.x - drag.cx) * 180) / Math.PI + 90;
      if (event.shiftKey) deg = Math.round(deg / 15) * 15; // snap with Shift
      deg = Math.round(deg);
      updateTransformById(drag.id, { rotation: deg });
      return;
    }

    // Resize: ratio of the dragged corner's distance from center vs. its start.
    const box = computeLayout(optionsRef.current).find((b) => b.id === drag.id);
    if (!box) return;
    const angle = (-box.rotation * Math.PI) / 180;
    const dx = point.x - box.cx;
    const dy = point.y - box.cy;
    const localX = Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle));
    const localY = Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle));
    const widthRatio = localX / Math.max(1, drag.startHalfW);
    const heightRatio = localY / Math.max(1, drag.startHalfH);

    const layer = imagesRef.current.find((l) => l.id === drag.id);
    const proportional = !layer || (layer.lockAspect ?? true);
    if (proportional) {
      const ratio = Math.max(widthRatio, heightRatio);
      const nextScale = clamp(drag.startScale * ratio, 0.05, 14);
      updateTransformById(drag.id, layer ? { scale: nextScale, scaleY: nextScale } : { scale: nextScale });
    } else {
      updateTransformById(drag.id, {
        scale: clamp(drag.startScale * widthRatio, 0.05, 14),
        scaleY: clamp(drag.startScaleY * heightRatio, 0.05, 14)
      });
    }
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current && previewRef.current?.hasPointerCapture(event.pointerId)) {
      previewRef.current.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  // ----- Call-outs -----
  const addSticker = (type: StickerType, defaults: Partial<Sticker>) => {
    stickerSeq.current += 1;
    setStickers((prev) => [
      ...prev,
      { id: `sticker-${stickerSeq.current}`, type, x: 0.5, y: 0.45, scale: 1, rotation: 0, color: defaults.color ?? "#ff2d2d", text: defaults.text ?? "" }
    ]);
  };
  const updateSticker = (id: string, patch: Partial<Sticker>) => setStickers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeSticker = (id: string) => setStickers((prev) => prev.filter((s) => s.id !== id));

  // ----- Keyboard: nudge with arrows, big nudge with Shift, delete to remove -----
  useEffect(() => {
    if (!editing || !selectedId) return;
    const handler = (event: KeyboardEvent) => {
      // Ignore when typing into a form field.
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (isLocked(selectedId)) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedId === "text") return; // text is cleared via its input, not deleted
        event.preventDefault();
        if (isStickerId(selectedId)) removeSticker(selectedId);
        else removeImage(selectedId);
        return;
      }

      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      };
      const delta = arrows[event.key];
      if (!delta) return;
      event.preventDefault();
      const stepPx = event.shiftKey ? 20 : 2;
      const dx = (delta[0] * stepPx) / 1280;
      const dy = (delta[1] * stepPx) / 720;
      const current =
        selectedId === "text"
          ? optionsRef.current.textTransform
          : isStickerId(selectedId)
            ? stickers.find((s) => s.id === selectedId)
            : imagesRef.current.find((l) => l.id === selectedId)?.transform;
      if (!current) return;
      updateTransformById(selectedId, {
        x: clamp(current.x + dx, 0, 1),
        y: clamp(current.y + dy, 0, 1)
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selectedId, stickers]);

  const generateVariants = () => {
    if (!overlayText.trim() && images.length === 0 && stickers.length === 0) {
      toast.error("Add an image, emoji, or thumbnail text first.");
      return;
    }
    const specs = buildVariants(options);
    setVariants(specs.map((spec) => ({ label: spec.label, png: renderToDataUrl(spec.options, "png"), jpeg: renderToDataUrl(spec.options, "jpeg") })));
    toast.success(`Generated ${specs.length} variants.`);
  };

  // ----- Saved thumbnails -----
  const currentSaved = savedThumbnails.find((item) => item.id === currentSavedId) ?? null;

  // Explicit project name (overrides the auto-derived name once set/renamed).
  const [projectName, setProjectName] = useState("");
  const derivedName = (projectName || title || overlayText || "Untitled thumbnail").trim().slice(0, 80) || "Untitled thumbnail";

  // Lightweight signature of all editable state (excludes raw image bytes — id +
  // treatment changes already cover background-removal/upload edits). Used to
  // detect unsaved changes and drive autosave without serializing megabytes.
  const stateSignature = useMemo(
    () =>
      JSON.stringify({
        projectName,
        title,
        overlayText,
        styleId,
        paletteIndex,
        intensity,
        emphasis,
        position,
        size,
        uppercase,
        fontId,
        textColor,
        highlightColor,
        textTransform,
        manualLayout,
        exportScale,
        exportWidth,
        exportHeight,
        stickers,
        images: images.map((l) => ({ id: l.id, name: l.name, t: l.transform, tm: l.treatment, locked: l.locked, la: l.lockAspect }))
      }),
    [projectName, title, overlayText, styleId, paletteIndex, intensity, emphasis, position, size, uppercase, fontId, textColor, highlightColor, textTransform, manualLayout, exportScale, exportWidth, exportHeight, stickers, images]
  );

  // The signature last written to storage; current !== this means "unsaved".
  const savedSignatureRef = useRef<string | null>(null);
  // Set while a project load is settling, so autosave doesn't treat the freshly
  // restored state as an unsaved edit.
  const pendingCleanLoadRef = useRef(false);

  /** Build the full persisted payload for a given identity. */
  const buildPayload = useCallback(
    (id: string, name: string, createdAt: string): SavedThumbnail => ({
      id,
      name,
      // Quarter-size JPEG keeps the gallery card light.
      preview: renderToDataUrl(optionsRef.current, "jpeg", 0.25),
      title,
      overlayText,
      style: styleId,
      paletteIndex,
      intensity,
      emphasis,
      position,
      size,
      uppercase,
      fontId,
      textColor,
      highlightColor,
      textTransform,
      manualLayout,
      exportScale,
      exportWidth,
      exportHeight,
      images: imagesRef.current.map((layer) => ({
        id: layer.id,
        name: layer.name,
        src: imageToDataUrl(layer.image),
        transform: layer.transform,
        treatment: layer.treatment,
        locked: layer.locked,
        lockAspect: layer.lockAspect
      })),
      stickers,
      createdAt,
      updatedAt: new Date().toISOString()
    }),
    [title, overlayText, styleId, paletteIndex, intensity, emphasis, position, size, uppercase, fontId, textColor, highlightColor, textTransform, manualLayout, exportScale, exportWidth, exportHeight, stickers]
  );

  /**
   * Persist the current setup. `asNew` mints a fresh project (Save As / first
   * save); otherwise it updates the current one. `silent` is used by autosave.
   * Returns the saved id, or null when persistence was skipped/failed.
   */
  const persist = useCallback(
    async ({ asNew = false, silent = false }: { asNew?: boolean; silent?: boolean } = {}): Promise<string | null> => {
      if (!overlayText.trim() && imagesRef.current.length === 0) {
        if (!silent) toast.error("Add thumbnail text or an image before saving.");
        return null;
      }
      const reuseId = !asNew && currentSavedId ? currentSavedId : null;
      const existing = reuseId ? savedThumbnails.find((item) => item.id === reuseId) : null;
      const id = reuseId ?? `thumb-${crypto.randomUUID()}`;
      const name = derivedName;
      const signature = stateSignature;
      setSaving(true);
      setSaveStatus("saving");
      try {
        const payload = buildPayload(id, name, existing?.createdAt ?? new Date().toISOString());
        await mutate("upsertSavedThumbnail", payload, silent ? undefined : { successMessage: existing ? `Updated "${name}".` : `Saved "${name}".` });
        savedSignatureRef.current = signature;
        setCurrentSavedId(id);
        setSaveStatus("saved");
        return id;
      } catch {
        setSaveStatus("error");
        if (!silent) toast.error("Could not save this thumbnail.");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [overlayText, currentSavedId, savedThumbnails, derivedName, stateSignature, buildPayload, mutate]
  );

  const saveThumbnail = (asNew = false) => void persist({ asNew });

  // Autosave: after the signature changes on an already-saved project, wait for
  // a quiet moment then persist silently. Manual edits flip the status to
  // "unsaved" immediately so the indicator is honest.
  useEffect(() => {
    if (pendingCleanLoadRef.current) return; // a load is settling; not a real edit
    if (savedSignatureRef.current === null) return; // nothing saved yet this session
    if (stateSignature === savedSignatureRef.current) return;
    setSaveStatus("unsaved");
    if (!autosave || !currentSavedId) return;
    const timer = window.setTimeout(() => {
      void persist({ silent: true });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [stateSignature, autosave, currentSavedId, persist]);

  const loadThumbnail = async (saved: SavedThumbnail) => {
    setLoadingSavedId(saved.id);
    try {
      // Fresh layer ids (via the shared generator) so restored layers never
      // collide with any added later this session.
      const layers: ImageLayer[] = await Promise.all(
        saved.images.map(async (item) => ({
          id: nextLayerId(),
          name: item.name,
          image: await loadImage(item.src),
          transform: item.transform,
          treatment: item.treatment,
          locked: item.locked,
          lockAspect: item.lockAspect
        }))
      );
      // Keep the sticker id generator ahead of any restored sticker ids.
      stickerSeq.current = Math.max(stickerSeq.current, maxIdSuffix(saved.stickers.map((s) => s.id)));

      setImages(layers);
      setProjectName(saved.name);
      setTitle(saved.title);
      setOverlayText(saved.overlayText);
      setStyleId(saved.style as BackgroundStyleId);
      setPaletteIndex(saved.paletteIndex);
      setIntensity(saved.intensity);
      setEmphasis(saved.emphasis);
      setPosition(saved.position);
      setSize(saved.size);
      setUppercase(saved.uppercase);
      setFontId(saved.fontId);
      setTextColor(saved.textColor);
      setHighlightColor(saved.highlightColor);
      setTextTransform(saved.textTransform);
      setManualLayout(saved.manualLayout);
      setExportScale(saved.exportScale);
      setExportWidth(saved.exportWidth ?? 1280);
      setExportHeight(saved.exportHeight ?? 720);
      setStickers(saved.stickers);
      setSelectedId(null);
      setEditing(false);
      setCurrentSavedId(saved.id);
      // Mark the just-loaded state as clean; the effect below captures the
      // freshly-computed signature on the next tick.
      pendingCleanLoadRef.current = true;
      setSaveStatus("saved");
      toast.success(`Loaded "${saved.name}".`);
    } catch {
      toast.error("Could not load that thumbnail.");
    } finally {
      setLoadingSavedId(null);
    }
  };

  // When a project is loaded, the editor state updates across several setters;
  // capture the resulting signature once as the clean baseline so autosave
  // doesn't immediately fire.
  useEffect(() => {
    if (pendingCleanLoadRef.current) {
      savedSignatureRef.current = stateSignature;
      pendingCleanLoadRef.current = false;
    }
  }, [stateSignature]);

  const deleteSavedThumbnail = async (saved: SavedThumbnail) => {
    await mutate("deleteSavedThumbnail", saved.id, { successMessage: `Deleted "${saved.name}".` });
    setCurrentSavedId((current) => {
      if (current === saved.id) {
        savedSignatureRef.current = null;
        setSaveStatus("idle");
        return null;
      }
      return current;
    });
  };

  const renameSavedThumbnail = async (saved: SavedThumbnail, nextName: string) => {
    const name = nextName.trim().slice(0, 80);
    if (!name || name === saved.name) {
      setRenamingId(null);
      return;
    }
    await mutate("upsertSavedThumbnail", { ...saved, name, updatedAt: new Date().toISOString() }, { successMessage: `Renamed to "${name}".` });
    if (currentSavedId === saved.id) setProjectName(name);
    setRenamingId(null);
  };

  const duplicateSavedThumbnail = async (saved: SavedThumbnail) => {
    const now = new Date().toISOString();
    const copy: SavedThumbnail = {
      ...saved,
      id: `thumb-${crypto.randomUUID()}`,
      name: `${saved.name} copy`.slice(0, 80),
      createdAt: now,
      updatedAt: now
    };
    await mutate("upsertSavedThumbnail", copy, { successMessage: `Duplicated "${saved.name}".` });
  };

  const ideas = useMemo(() => overlayIdeas(title), [title]);
  const treatments = useMemo(() => titleTreatments(title), [title]);
  const exportName = (suffix: string) =>
    `thumbnail-${(title || overlayText || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}${suffix}`;

  const stickerLabel = (sticker: Sticker, index: number) => `${sticker.type[0].toUpperCase()}${sticker.type.slice(1)} ${index + 1}`;
  const selectedLabel =
    selectedId === "text"
      ? "Text"
      : selectedId && isStickerId(selectedId)
        ? (() => {
            const index = stickers.findIndex((s) => s.id === selectedId);
            return index >= 0 ? stickerLabel(stickers[index], index) : null;
          })()
        : images.find((l) => l.id === selectedId)?.name ?? null;
  const customColor = textColor !== "auto";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creator Tools"
        title="Thumbnail Generator"
        description="Create 1280×720 YouTube thumbnails: stack up to 5 images, cut out your subject, add bold call-outs, pick a font, and color your keywords. Double-click the preview to move, scale, and rotate. Everything renders in your browser."
      />

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        {/* Left: controls */}
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Saved thumbnails</h2>
              <Badge>{savedThumbnails.length}</Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Save the current setup to your library and reopen it any time. Use <span className="text-white">Save thumbnail</span> next to the preview.
            </p>

            {savedThumbnails.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-dashed border-white/10 bg-black/20 px-3 py-4 text-xs text-[var(--muted-foreground)]">
                Nothing saved yet. Build a thumbnail, then hit Save — your images, text, layout, and call-outs are all stored.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {savedThumbnails.map((saved) => (
                  <div
                    key={saved.id}
                    className={cn(
                      "group overflow-hidden rounded-2xl border transition",
                      currentSavedId === saved.id ? "border-[var(--accent)] ring-1 ring-[var(--accent)]/40" : "border-white/10 hover:border-white/30"
                    )}
                  >
                    <button type="button" onClick={() => void loadThumbnail(saved)} className="block w-full text-left" disabled={loadingSavedId === saved.id}>
                      {saved.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={saved.preview} alt={saved.name} className="aspect-video w-full bg-black/40 object-cover" />
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center bg-black/40 text-xs text-[var(--muted-foreground)]">No preview</div>
                      )}
                    </button>
                    <div className="flex items-center gap-1 px-2.5 py-2">
                      {renamingId === saved.id ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => void renameSavedThumbnail(saved, renameDraft)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void renameSavedThumbnail(saved, renameDraft);
                            if (event.key === "Escape") setRenamingId(null);
                          }}
                          className="min-w-0 flex-1 rounded-md border border-[var(--accent)] bg-black/40 px-1.5 py-0.5 text-xs text-white outline-none"
                        />
                      ) : (
                        <p className="min-w-0 flex-1 truncate text-xs font-medium text-white" title={saved.name}>
                          {saved.name}
                        </p>
                      )}
                      <button
                        type="button"
                        title="Rename"
                        onClick={() => {
                          setRenamingId(saved.id);
                          setRenameDraft(saved.name);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 text-[var(--muted-foreground)] transition hover:bg-white/15 hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Duplicate project"
                        onClick={() => void duplicateSavedThumbnail(saved)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 text-[var(--muted-foreground)] transition hover:bg-white/15 hover:text-white"
                      >
                        <CopyPlus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Open"
                        onClick={() => void loadThumbnail(saved)}
                        disabled={loadingSavedId === saved.id}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 text-[var(--muted-foreground)] transition hover:bg-white/15 hover:text-white disabled:opacity-40"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => void deleteSavedThumbnail(saved)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 text-[var(--muted-foreground)] transition hover:bg-red-500/20 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Images</h2>
              <Badge>
                {images.length}/{MAX_IMAGES}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Add up to {MAX_IMAGES} images. In free-placement mode each one can be dragged, rotated, and scaled on the canvas.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) handleFiles(event.target.files);
                event.target.value = "";
              }}
            />

            {images.length > 0 && (
              <div className="mt-4 space-y-2">
                {images.map((layer, index) => (
                  <div
                    key={layer.id}
                    onClick={() => setSelectedId(layer.id)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2 transition",
                      selectedId === layer.id ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-white/10 bg-black/20 hover:border-white/30"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={layer.image.src} alt={layer.name} className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-cover" />
                    <p className="min-w-0 flex-1 truncate text-sm text-white">{layer.name}</p>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        title="Send backward"
                        disabled={index === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveLayer(layer.id, -1);
                        }}
                        className="rounded-lg bg-white/8 px-2 py-1 text-xs text-white transition hover:bg-white/15 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        title="Bring forward"
                        disabled={index === images.length - 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveLayer(layer.id, 1);
                        }}
                        className="rounded-lg bg-white/8 px-2 py-1 text-xs text-white transition hover:bg-white/15 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title="Remove image"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeImage(layer.id);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 text-[var(--muted-foreground)] transition hover:bg-red-500/20 hover:text-red-400"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {images.length < MAX_IMAGES && (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files);
                }}
                onDragOver={(event) => event.preventDefault()}
                className="mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/12 bg-white/3 py-6 transition hover:border-[var(--accent)]/50"
              >
                <ImagePlus className="h-6 w-6 text-[var(--accent)]" />
                <p className="text-sm font-medium text-white">Drop images or click to browse</p>
                <p className="text-xs text-[var(--muted-foreground)]">PNG, JPEG, or WebP · up to 15MB each</p>
              </div>
            )}

            <div className="mt-4 space-y-3">
              <Input placeholder="Video title or topic (drives copy suggestions)" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Input
                placeholder="Thumbnail text — wrap a word in *asterisks* to color it"
                value={overlayText}
                onChange={(event) => setOverlayText(event.target.value)}
              />
            </div>
          </Card>

          {activeImage && (
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Subject</h2>
                <span className="max-w-[55%] truncate text-xs text-[var(--muted-foreground)]">{activeImage.name}</span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Cut-out treatment for the selected image. Remove its background for the floating-subject look.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Placement</span>
                  <Select
                    value={activeImage.treatment.cutout ? "cutout" : "panel"}
                    onChange={(event) => updateTreatment(activeImage.id, { cutout: event.target.value === "cutout" })}
                  >
                    <option value="panel">Right panel (auto)</option>
                    <option value="cutout">Free cut-out</option>
                  </Select>
                </label>
                <label className="flex items-end gap-2 pb-3 text-sm text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    checked={activeImage.treatment.flip}
                    onChange={(event) => updateTreatment(activeImage.id, { flip: event.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Flip horizontally
                </label>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Range label="Stroke" value={activeImage.treatment.stroke} min={0} max={28} step={1} onChange={(v) => updateTreatment(activeImage.id, { stroke: v })} format={(v) => `${v}px`} />
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Stroke color</span>
                  <input
                    type="color"
                    value={activeImage.treatment.strokeColor}
                    onChange={(event) => updateTreatment(activeImage.id, { strokeColor: event.target.value })}
                    className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-black/20"
                  />
                </label>
                <Range label="Glow" value={activeImage.treatment.glow} min={0} max={1} step={0.05} onChange={(v) => updateTreatment(activeImage.id, { glow: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Range label="Saturation" value={activeImage.treatment.saturate} min={0} max={2} step={0.05} onChange={(v) => updateTreatment(activeImage.id, { saturate: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Range label="Contrast" value={activeImage.treatment.contrast} min={0.5} max={1.8} step={0.05} onChange={(v) => updateTreatment(activeImage.id, { contrast: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Range label="Brightness" value={activeImage.treatment.brightness} min={0.5} max={1.6} step={0.05} onChange={(v) => updateTreatment(activeImage.id, { brightness: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--muted-foreground)]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={activeImage.treatment.shadow}
                    onChange={(event) => updateTreatment(activeImage.id, { shadow: event.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Drop shadow
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={activeImage.treatment.backlight}
                    onChange={(event) => updateTreatment(activeImage.id, { backlight: event.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Accent backlight
                </label>
              </div>

              <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                <Range label="BG removal tolerance" value={bgTolerance} min={8} max={120} step={2} onChange={setBgTolerance} />
                <Button variant="secondary" className="w-full" onClick={handleRemoveBackground} disabled={removingBg}>
                  <Eraser className="mr-2 h-4 w-4" />
                  {removingBg ? "Removing…" : "Remove background"}
                </Button>
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Layout</h2>
              <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  checked={manualLayout}
                  onChange={(event) => {
                    setManualLayout(event.target.checked);
                    if (!event.target.checked) setEditing(false);
                  }}
                  className="h-4 w-4 rounded border-white/20 bg-black/20"
                />
                Free placement
              </label>
            </div>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {manualLayout
                ? "Drag text and images anywhere. Use the controls below or the canvas to position them."
                : "Automatic, background-aware layout. Turn on free placement (or double-click the preview) to move things yourself."}
            </p>

            {manualLayout && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant={editing ? "primary" : "secondary"} className="flex-1" onClick={() => setEditing((value) => !value)}>
                    <MousePointer2 className="mr-2 h-4 w-4" />
                    {editing ? "Editing on" : "Edit on canvas"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setTextTransform(DEFAULT_TEXT_TRANSFORM);
                      setImages((current) => current.map((layer, index) => ({ ...layer, transform: defaultImageTransform(index) })));
                      toast.success("Layout reset.");
                    }}
                  >
                    Reset
                  </Button>
                </div>

                {/* Layer selector */}
                <div className="flex flex-wrap gap-2">
                  {overlayText.trim() && (
                    <button
                      type="button"
                      onClick={() => setSelectedId("text")}
                      className={cn(
                        "rounded-xl border px-3 py-1.5 text-xs font-medium transition",
                        selectedId === "text" ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white" : "border-white/10 bg-black/20 text-[var(--muted-foreground)] hover:border-white/30"
                      )}
                    >
                      Text
                    </button>
                  )}
                  {images.map((layer, index) => (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => setSelectedId(layer.id)}
                      className={cn(
                        "rounded-xl border px-3 py-1.5 text-xs font-medium transition",
                        selectedId === layer.id ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white" : "border-white/10 bg-black/20 text-[var(--muted-foreground)] hover:border-white/30"
                      )}
                    >
                      Image {index + 1}
                    </button>
                  ))}
                  {stickers.map((sticker, index) => (
                    <button
                      key={sticker.id}
                      type="button"
                      onClick={() => setSelectedId(sticker.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-medium transition",
                        selectedId === sticker.id ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white" : "border-white/10 bg-black/20 text-[var(--muted-foreground)] hover:border-white/30"
                      )}
                    >
                      {sticker.type === "emoji" && sticker.text ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={appleEmojiUrl(sticker.text)} alt={sticker.text} className="h-4 w-4" />
                      ) : null}
                      {stickerLabel(sticker, index)}
                    </button>
                  ))}
                </div>

                {selectedTransform && selectedLabel && selectedId ? (
                  (() => {
                    const aspect = selectedImage ? selectedImage.image.height / selectedImage.image.width : 1;
                    const baseHeight = IMAGE_BASE_WIDTH * aspect;
                    const widthPx = IMAGE_BASE_WIDTH * selectedTransform.scale;
                    const heightPx = IMAGE_BASE_WIDTH * effectiveScaleY(selectedTransform) * aspect;
                    const proportional = selectedImage ? selectedImage.lockAspect ?? true : true;
                    const locked = selectedImage?.locked ?? false;
                    return (
                      <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center justify-between">
                          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-white">
                            <Layers className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                            <span className="truncate">{selectedLabel}</span>
                            {locked && <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />}
                          </span>
                        </div>

                        {/* Layer action toolbar (image layers only). */}
                        {selectedImage && (
                          <div className="flex flex-wrap gap-1.5">
                            <ToolButton
                              title="Duplicate"
                              disabled={images.length >= MAX_IMAGES}
                              onClick={() => duplicateImage(selectedImage)}
                            >
                              <CopyPlus className="h-4 w-4" />
                            </ToolButton>
                            <ToolButton title={locked ? "Unlock" : "Lock"} active={locked} onClick={() => toggleLock(selectedId)}>
                              {locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                            </ToolButton>
                            <ToolButton title="Bring to front" disabled={locked} onClick={() => moveLayerEdge(selectedId, "front")}>
                              <ChevronsUp className="h-4 w-4" />
                            </ToolButton>
                            <ToolButton title="Bring forward" disabled={locked} onClick={() => moveLayer(selectedId, 1)}>
                              <ArrowUpToLine className="h-4 w-4" />
                            </ToolButton>
                            <ToolButton title="Send backward" disabled={locked} onClick={() => moveLayer(selectedId, -1)}>
                              <ArrowDownToLine className="h-4 w-4" />
                            </ToolButton>
                            <ToolButton title="Send to back" disabled={locked} onClick={() => moveLayerEdge(selectedId, "back")}>
                              <ChevronsDown className="h-4 w-4" />
                            </ToolButton>
                            <ToolButton title="Reset transform" disabled={locked} onClick={() => resetTransform(selectedId)}>
                              <RotateCcw className="h-4 w-4" />
                            </ToolButton>
                            <ToolButton title="Delete" danger disabled={locked} onClick={() => removeImage(selectedId)}>
                              <Trash2 className="h-4 w-4" />
                            </ToolButton>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <NumberField
                            label="X"
                            value={selectedTransform.x * 1280}
                            suffix="px"
                            disabled={locked}
                            onChange={(v) => updateSelectedTransform({ x: clamp(v / 1280, 0, 1) })}
                          />
                          <NumberField
                            label="Y"
                            value={selectedTransform.y * 720}
                            suffix="px"
                            disabled={locked}
                            onChange={(v) => updateSelectedTransform({ y: clamp(v / 720, 0, 1) })}
                          />
                          {selectedImage ? (
                            <>
                              <NumberField
                                label="Width"
                                value={widthPx}
                                min={8}
                                suffix="px"
                                disabled={locked}
                                onChange={(v) => {
                                  const scale = clamp(v / IMAGE_BASE_WIDTH, 0.02, 14);
                                  updateSelectedTransform(proportional ? { scale, scaleY: scale } : { scale });
                                }}
                              />
                              <NumberField
                                label="Height"
                                value={heightPx}
                                min={8}
                                suffix="px"
                                disabled={locked}
                                onChange={(v) => {
                                  const next = clamp(v / baseHeight, 0.02, 14);
                                  updateSelectedTransform(proportional ? { scale: next, scaleY: next } : { scaleY: next });
                                }}
                              />
                            </>
                          ) : (
                            <NumberField
                              label="Scale"
                              value={selectedTransform.scale * 100}
                              min={5}
                              suffix="%"
                              disabled={locked}
                              onChange={(v) => updateSelectedTransform({ scale: clamp(v / 100, 0.05, 14) })}
                            />
                          )}
                          <NumberField
                            label="Rotation"
                            value={selectedTransform.rotation}
                            suffix="°"
                            disabled={locked}
                            onChange={(v) => updateSelectedTransform({ rotation: normalizeAngle(v) })}
                          />
                          <NumberField
                            label="Opacity"
                            value={effectiveOpacity(selectedTransform) * 100}
                            min={0}
                            max={100}
                            suffix="%"
                            disabled={locked}
                            onChange={(v) => updateSelectedTransform({ opacity: clamp(v / 100, 0, 1) })}
                          />
                        </div>

                        {/* Opacity + rotation sliders for quick dragging. */}
                        <Range
                          label="Opacity"
                          value={effectiveOpacity(selectedTransform)}
                          min={0}
                          max={1}
                          step={0.01}
                          onChange={(v) => updateSelectedTransform({ opacity: v })}
                          format={(v) => `${Math.round(v * 100)}%`}
                        />
                        <Range
                          label="Rotation"
                          value={selectedTransform.rotation}
                          min={-180}
                          max={180}
                          step={1}
                          onChange={(v) => updateSelectedTransform({ rotation: v })}
                          format={(v) => `${Math.round(v)}°`}
                        />

                        {selectedImage && (
                          <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                            <button
                              type="button"
                              onClick={() => toggleAspectLock(selectedId)}
                              disabled={locked}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition disabled:opacity-30",
                                proportional ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-white" : "border-white/10 bg-white/5 hover:border-white/30"
                              )}
                            >
                              {proportional ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
                              {proportional ? "Aspect locked (proportional)" : "Free width / height"}
                            </button>
                          </label>
                        )}
                        <p className="text-[11px] text-[var(--muted-foreground)]">
                          Drag corners to resize, the top handle to rotate. Arrow keys nudge, Shift+arrows move further, Delete removes.
                        </p>
                      </div>
                    );
                  })()
                ) : (
                  <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-3 py-3 text-xs text-[var(--muted-foreground)]">
                    Select a layer above (or click it on the canvas) to move, scale, rotate, and adjust opacity.
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Style</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Background</span>
                <Select
                  value={styleId}
                  onChange={(event) => {
                    setStyleId(event.target.value as BackgroundStyleId);
                    setPaletteIndex(0);
                  }}
                >
                  {BACKGROUND_STYLES.map((bg) => (
                    <option key={bg.id} value={bg.id}>
                      {bg.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Font</span>
                <Select value={fontId} onChange={(event) => setFontId(event.target.value)}>
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Intensity</span>
                <Select value={intensity} onChange={(event) => setIntensity(event.target.value as Intensity)}>
                  <option value="subtle">Subtle</option>
                  <option value="balanced">Balanced</option>
                  <option value="bold">Bold</option>
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Text emphasis</span>
                <Select value={emphasis} onChange={(event) => setEmphasis(event.target.value as TextEmphasis)}>
                  <option value="outline">Outline</option>
                  <option value="highlight-bar">Highlight bar</option>
                  <option value="boxed">Boxed panel</option>
                  <option value="clean">Clean shadow</option>
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Text position</span>
                <Select value={position} onChange={(event) => setPosition(event.target.value as TextPosition)} disabled={manualLayout}>
                  <option value="left">Left</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="center">Center</option>
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Text size</span>
                <Select value={size} onChange={(event) => setSize(event.target.value as TextSize)}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </Select>
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Highlight color (*word*)</span>
                <input
                  type="color"
                  value={highlightColor}
                  onChange={(event) => setHighlightColor(event.target.value)}
                  className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-black/20"
                />
              </label>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    checked={customColor}
                    onChange={(event) => setTextColor(event.target.checked ? "#ffffff" : "auto")}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Custom text color
                </label>
                {customColor && (
                  <input
                    type="color"
                    value={textColor}
                    onChange={(event) => setTextColor(event.target.value)}
                    className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-black/20"
                  />
                )}
              </div>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={uppercase}
                onChange={(event) => setUppercase(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-black/20"
              />
              Uppercase text
            </label>

            <div className="mt-4">
              <span className="mb-2 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Palette: {style.palettes[paletteIndex % style.palettes.length].name}
              </span>
              <div className="flex flex-wrap gap-2">
                {style.palettes.map((palette, index) => (
                  <button
                    key={palette.name}
                    type="button"
                    title={palette.name}
                    onClick={() => setPaletteIndex(index)}
                    className={cn(
                      "flex h-9 items-center gap-0 overflow-hidden rounded-xl border transition",
                      index === paletteIndex % style.palettes.length ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/40" : "border-white/10 hover:border-white/30"
                    )}
                  >
                    {[palette.bg1, palette.bg2, palette.accent].map((color, swatch) => (
                      <span key={swatch} className="h-full w-7" style={{ backgroundColor: color }} />
                    ))}
                  </button>
                ))}
              </div>
            </div>

            <Button className="mt-5 w-full" onClick={generateVariants}>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate 10 variants
            </Button>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Call-outs</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Add circles, arrows, emoji, and number badges. Drag them on the canvas in edit mode, or fine-tune with the sliders.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STICKER_PRESETS.map((preset) => (
                <button
                  key={preset.type}
                  type="button"
                  onClick={() => addSticker(preset.type, preset.defaults)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-white transition hover:border-[var(--accent)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {preset.label}
                </button>
              ))}
            </div>

            {stickers.length > 0 && (
              <div className="mt-4 space-y-3">
                {stickers.map((sticker) => (
                  <div key={sticker.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-white">{sticker.type}</span>
                      <button
                        type="button"
                        title="Remove call-out"
                        onClick={() => removeSticker(sticker.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 text-[var(--muted-foreground)] transition hover:bg-red-500/20 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {sticker.type === "emoji" && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {EMOJI_CHOICES.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            title={emoji}
                            onClick={() => updateSticker(sticker.id, { text: emoji })}
                            className={cn(
                              "rounded-lg p-1.5 transition",
                              sticker.text === emoji ? "bg-[var(--accent)]/25 ring-1 ring-[var(--accent)]" : "bg-white/5 hover:bg-white/10"
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={appleEmojiUrl(emoji)} alt={emoji} className="h-6 w-6" />
                          </button>
                        ))}
                      </div>
                    )}

                    {sticker.type === "badge" && (
                      <Input
                        className="mt-2"
                        placeholder="Badge text (e.g. $10K)"
                        value={sticker.text}
                        onChange={(event) => updateSticker(sticker.id, { text: event.target.value })}
                      />
                    )}

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Range label="X" value={sticker.x} min={0} max={1} step={0.01} onChange={(v) => updateSticker(sticker.id, { x: v })} format={(v) => v.toFixed(2)} />
                      <Range label="Y" value={sticker.y} min={0} max={1} step={0.01} onChange={(v) => updateSticker(sticker.id, { y: v })} format={(v) => v.toFixed(2)} />
                      <Range label="Scale" value={sticker.scale} min={0.3} max={3} step={0.05} onChange={(v) => updateSticker(sticker.id, { scale: v })} format={(v) => `${Math.round(v * 100)}%`} />
                      <Range label="Rotation" value={sticker.rotation} min={-180} max={180} step={5} onChange={(v) => updateSticker(sticker.id, { rotation: v })} format={(v) => `${v}°`} />
                    </div>

                    {sticker.type !== "emoji" && (
                      <label className="mt-2 block">
                        <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Color</span>
                        <input
                          type="color"
                          value={sticker.color}
                          onChange={(event) => updateSticker(sticker.id, { color: event.target.value })}
                          className="h-9 w-full cursor-pointer rounded-xl border border-white/10 bg-black/20"
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {(ideas.length > 0 || treatments.length > 0) && (
            <Card>
              <h2 className="text-lg font-semibold text-white">Copy ideas</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Derived from your title. Click to use as thumbnail text.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {ideas.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setOverlayText(idea)}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-white transition hover:border-[var(--accent)]"
                  >
                    {idea}
                  </button>
                ))}
              </div>
              {treatments.length > 0 && (
                <div className="mt-4 space-y-2">
                  <span className="block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Video title treatments</span>
                  {treatments.map((treatment) => (
                    <div key={treatment} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2">
                      <p className="text-sm text-white">{treatment}</p>
                      <button
                        type="button"
                        title="Copy title"
                        onClick={() => void copyText(treatment, "Title")}
                        className="shrink-0 text-[var(--muted-foreground)] transition hover:text-white"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Right: preview + variants — pinned in view while the controls scroll. */}
        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Preview</h2>
              <div className="flex items-center gap-2">
                {editing && <Badge>Editing</Badge>}
                <Badge>1280 × 720</Badge>
              </div>
            </div>
            <canvas
              ref={previewRef}
              onDoubleClick={enterEditMode}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn(
                "mt-4 aspect-video w-full touch-none rounded-2xl border bg-black/40",
                editing ? "cursor-move border-[var(--accent)]/60" : "cursor-pointer border-white/10"
              )}
            />
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {editing
                ? "Drag any layer to reposition it. Click empty space to deselect. Use the Layout panel to scale and rotate."
                : "Double-click to edit the layout directly on the canvas."}
            </p>

            <div className="mt-4 flex items-start gap-4">
              <div className="shrink-0">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Mobile feed size</span>
                {smallPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={smallPreview} alt="Small preview" className="w-40 rounded-md border border-white/10" style={{ aspectRatio: "16 / 9" }} />
                ) : (
                  <div className="w-40 rounded-md border border-white/10 bg-black/40" style={{ aspectRatio: "16 / 9" }} />
                )}
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Check the small render — thumbnails are mostly seen at this size. Keep text to 1–4 words and faces large.
              </p>
            </div>

            {/* ---- Project / save ---- */}
            <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Project name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  className="h-9 flex-1"
                />
                <SaveStatusBadge status={saveStatus} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => saveThumbnail(false)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Saving…" : currentSaved ? "Save" : "Save project"}
                </Button>
                {currentSaved && (
                  <Button variant="secondary" onClick={() => saveThumbnail(true)} disabled={saving}>
                    <CopyPlus className="mr-2 h-4 w-4" />
                    Save as
                  </Button>
                )}
                <label className="ml-auto flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    checked={autosave}
                    onChange={(event) => setAutosave(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Autosave
                </label>
              </div>
            </div>

            {/* ---- Export ---- */}
            <div className="mt-3 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Export</span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  {[
                    { label: "1280×720", w: 1280, h: 720 },
                    { label: "1920×1080", w: 1920, h: 1080 },
                    { label: "2560×1440", w: 2560, h: 1440 }
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setExportWidth(preset.w);
                        setExportHeight(preset.h);
                      }}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition",
                        exportWidth === preset.w && exportHeight === preset.h
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
                          : "border-white/10 bg-white/5 text-[var(--muted-foreground)] hover:border-white/30"
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <NumberField label="Width" value={exportWidth} min={16} max={8192} suffix="px" onChange={(v) => setExportWidth(clamp(Math.round(v), 16, 8192))} />
                <NumberField label="Height" value={exportHeight} min={16} max={8192} suffix="px" onChange={(v) => setExportHeight(clamp(Math.round(v), 16, 8192))} />
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Format</span>
                  <Select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as "png" | "jpeg")} className="h-9 px-2">
                    <option value="png">PNG</option>
                    <option value="jpeg">JPG</option>
                  </Select>
                </label>
              </div>
              <Button
                className="w-full"
                onClick={() =>
                  downloadDataUrl(
                    renderToSizedDataUrl(options, exportWidth, exportHeight, exportFormat),
                    exportName(`-${exportWidth}x${exportHeight}.${exportFormat === "png" ? "png" : "jpg"}`)
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Export {exportWidth}×{exportHeight} {exportFormat.toUpperCase()}
              </Button>
              <label className="ml-auto flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                Export
                <Select
                  value={String(exportScale)}
                  onChange={(event) => setExportScale(Number(event.target.value))}
                  className="h-9 w-auto px-2"
                >
                  <option value="1">1× (1280)</option>
                  <option value="2">2× (2560)</option>
                </Select>
              </label>
            </div>
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">{style.description}</p>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Variants</h2>
            {variants.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                Set up your thumbnail on the left, then hit <span className="text-white">Generate 10 variants</span> for options with rotated palettes,
                emphasis, and varied text/image positions and rotations.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {variants.map((variant, index) => (
                  <div key={variant.label} className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={variant.png} alt={variant.label} className="aspect-video w-full rounded-xl border border-white/10" />
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{variant.label}</p>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          title="Download PNG"
                          onClick={() => downloadDataUrl(variant.png, exportName(`-${index + 1}.png`))}
                          className="rounded-lg bg-white/8 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-white/15"
                        >
                          PNG
                        </button>
                        <button
                          type="button"
                          title="Download JPEG"
                          onClick={() => downloadDataUrl(variant.jpeg, exportName(`-${index + 1}.jpg`))}
                          className="rounded-lg bg-white/8 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-white/15"
                        >
                          JPG
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
