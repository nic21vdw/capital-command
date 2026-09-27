"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { CAPTION_PRESETS } from "@/lib/clipping/captions";
import { captionStyleForPreset } from "@/lib/clipping/editor";
import { cn } from "@/lib/utils";
import type { CaptionPresetId, CaptionStyle } from "@/types/domain";

const BASE_SCALE = 0.046;
const BASE_PX = 15;

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean.padEnd(6, "0");
  const n = Number.parseInt(full.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function useBeat(active: boolean, steps: number) {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setBeat((value) => (value + 1) % steps), 520);
    return () => window.clearInterval(timer);
  }, [active, steps]);
  return beat;
}

function CaptionSample({ style, words, beat }: { style: CaptionStyle; words: string[]; beat: number }) {
  const fontPx = Math.round((BASE_PX * style.fontScale) / BASE_SCALE);
  const active = beat % words.length;
  const karaoke = style.animation === "karaoke";
  const shown = style.maxWordsPerCaption <= 1 ? [words[active]] : words.slice(0, Math.max(1, style.maxWordsPerCaption));
  const activeInShown = style.maxWordsPerCaption <= 1 ? 0 : active;
  const shadows = [
    style.shadow > 0 ? `0 ${Math.max(1, style.shadow * 0.5)}px ${Math.max(1, style.shadow)}px rgba(0,0,0,0.75)` : null,
    style.glowColor ? `0 0 ${Math.round(fontPx * 0.35)}px ${style.glowColor}` : null,
    style.glowColor ? `0 0 ${Math.round(fontPx * 0.8)}px ${style.glowColor}` : null
  ].filter(Boolean);
  const text: CSSProperties = {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.italic ? "italic" : undefined,
    fontSize: fontPx,
    lineHeight: 1.1,
    color: style.textColor,
    textTransform: style.uppercase ? "uppercase" : undefined,
    textShadow: shadows.length ? shadows.join(", ") : undefined,
    WebkitTextStroke: style.outlineWidth > 0 ? `${Math.min(3, style.outlineWidth * 0.32)}px #000` : undefined,
    paintOrder: "stroke fill",
    background: style.backgroundOpacity > 0.02 ? hexToRgba(style.backgroundColor, style.backgroundOpacity) : undefined,
    padding: style.backgroundOpacity > 0.02 ? "3px 7px" : undefined,
    borderRadius: 6
  };
  return (
    <span className="inline-block max-w-full text-center" style={text}>
      {shown.map((word, index) => {
        const isActive = index === activeInShown;
        const lit = isActive || (karaoke && index < activeInShown);
        return (
          <span key={`${word}-${index}`}>
            <span
              className="mx-[0.12em] inline-block transition-[transform,color,opacity] duration-150 ease-out"
              style={{
                color: lit ? style.highlightColor : undefined,
                opacity: karaoke && index > activeInShown ? 0.55 : 1,
                transform: isActive && style.animation !== "none" && style.animation !== "fade" ? "scale(1.06)" : undefined
              }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function CaptionStylePicker({
  value,
  options,
  onChange,
  disabled
}: {
  value: CaptionPresetId;
  options: CaptionPresetId[];
  onChange: (preset: CaptionPresetId) => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState<CaptionPresetId | null>(null);
  const beat = useBeat(true, 3);

  return (
    <div role="radiogroup" aria-label="Caption style" className="grid grid-cols-3 gap-2">
      {options.map((id) => {
        const preset = CAPTION_PRESETS[id];
        const style = captionStyleForPreset(id);
        const selected = id === value;
        const animated = selected || hovered === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            title={preset.description ?? preset.label}
            onClick={() => onChange(id)}
            onPointerEnter={() => setHovered(id)}
            onPointerLeave={() => setHovered((current) => (current === id ? null : current))}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-xl border text-left transition duration-150",
              selected
                ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)]/35"
                : "border-white/10 bg-[var(--well)] hover:border-white/25",
              disabled && "cursor-not-allowed opacity-60"
            )}
          >
            <span className="flex h-[74px] items-center justify-center overflow-hidden bg-[#14151b] px-1.5">
              <CaptionSample
                style={style}
                words={preset.sample ?? ["your", "caption", "here"]}
                beat={animated ? beat : 0}
              />
            </span>
            <span className="flex items-center justify-between gap-1 px-2 py-1.5">
              <span className="truncate text-[11px] font-medium text-white">{preset.label}</span>
              {selected && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)]">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
