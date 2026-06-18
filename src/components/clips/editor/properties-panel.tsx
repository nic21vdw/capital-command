"use client";

import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import type { ClipFraming, VideoClip } from "@/types/domain";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { clipDuration, defaultFraming, formatTimecode, LAYOUT_PRESETS, parseTimecode } from "./presets";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onLive,
  onCommit
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onLive(Number(e.target.value))}
      onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--accent)]"
    />
  );
}

function TimeInput({ value, onCommit }: { value: number; onCommit: (seconds: number) => void }) {
  // `draft` is non-null only while editing, so the field always reflects the
  // latest prop value otherwise — no effect-driven syncing required.
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? formatTimecode(value, true);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseTimecode(draft);
    if (parsed !== null) onCommit(parsed);
    setDraft(null);
  };
  return (
    <input
      value={display}
      onFocus={() => setDraft(formatTimecode(value, true))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm text-white outline-none focus:border-[var(--accent)]"
    />
  );
}

function ButtonRow<T extends string>({
  options,
  value,
  onChange
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "flex-1 rounded-md border px-2 py-1.5 text-xs transition",
            value === opt.id
              ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
              : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function PropertiesPanel({
  clip,
  framing,
  aspectLabel,
  updateClip,
  updateFraming,
  applyLayout
}: {
  clip: VideoClip;
  framing: ClipFraming;
  aspectLabel: string;
  updateClip: (patch: Partial<VideoClip>, commit: boolean) => void;
  updateFraming: (patch: Partial<ClipFraming>, commit: boolean) => void;
  applyLayout: (presetId: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Trim & timing */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Trim &amp; timing</h3>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Start">
            <TimeInput value={clip.sourceStart} onCommit={(v) => updateClip({ sourceStart: Math.min(v, clip.sourceEnd - 0.1) }, true)} />
          </Field>
          <Field label="End">
            <TimeInput value={clip.sourceEnd} onCommit={(v) => updateClip({ sourceEnd: Math.max(v, clip.sourceStart + 0.1) }, true)} />
          </Field>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">Output duration {formatTimecode(clipDuration(clip), true)}</p>
        <Field label={`Speed · ${clip.speed}×`}>
          <Select value={clip.speed} onChange={(e) => updateClip({ speed: Number(e.target.value) }, true)}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </Select>
        </Field>
      </section>

      {/* Audio */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Audio</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateClip({ muted: !clip.muted }, true)}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
              clip.muted ? "border-red-400/40 bg-red-500/15 text-red-300" : "border-[var(--border)] text-white"
            )}
            title={clip.muted ? "Unmute" : "Mute"}
          >
            {clip.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <div className="flex-1">
            <Slider
              value={clip.volume}
              min={0}
              max={1}
              step={0.01}
              onLive={(v) => updateClip({ volume: v }, false)}
              onCommit={(v) => updateClip({ volume: v }, true)}
            />
          </div>
          <span className="w-10 text-right text-xs text-[var(--muted-foreground)]">{Math.round(clip.volume * 100)}%</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`Fade in · ${clip.fadeIn.toFixed(1)}s`}>
            <Slider value={clip.fadeIn} min={0} max={5} step={0.1} onLive={(v) => updateClip({ fadeIn: v }, false)} onCommit={(v) => updateClip({ fadeIn: v }, true)} />
          </Field>
          <Field label={`Fade out · ${clip.fadeOut.toFixed(1)}s`}>
            <Slider value={clip.fadeOut} min={0} max={5} step={0.1} onLive={(v) => updateClip({ fadeOut: v }, false)} onCommit={(v) => updateClip({ fadeOut: v }, true)} />
          </Field>
        </div>
      </section>

      {/* Reframe */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Reframe</h3>
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{aspectLabel}</span>
        </div>
        <ButtonRow
          options={[
            { id: "fit", label: "Fit" },
            { id: "fill", label: "Fill" },
            { id: "crop", label: "Crop" }
          ]}
          value={framing.mode}
          onChange={(mode) => updateFraming({ mode }, true)}
        />
        <Field label={`Scale · ${framing.scale.toFixed(2)}×`}>
          <Slider value={framing.scale} min={0.3} max={5} step={0.01} onLive={(v) => updateFraming({ scale: v }, false)} onCommit={(v) => updateFraming({ scale: v }, true)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Position X">
            <Slider value={framing.x} min={-1} max={1} step={0.005} onLive={(v) => updateFraming({ x: v }, false)} onCommit={(v) => updateFraming({ x: v }, true)} />
          </Field>
          <Field label="Position Y">
            <Slider value={framing.y} min={-1} max={1} step={0.005} onLive={(v) => updateFraming({ y: v }, false)} onCommit={(v) => updateFraming({ y: v }, true)} />
          </Field>
        </div>
        <Field label={`Rotation · ${framing.rotation}°`}>
          <Slider value={framing.rotation} min={-180} max={180} step={1} onLive={(v) => updateFraming({ rotation: v }, false)} onCommit={(v) => updateFraming({ rotation: v }, true)} />
        </Field>
        <button
          type="button"
          onClick={() => updateFraming(defaultFraming(framing.mode), true)}
          className="w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted-foreground)] transition hover:text-white"
        >
          Reset position &amp; scale
        </button>
      </section>

      {/* Layout presets */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Layouts</h3>
        <p className="text-xs text-[var(--muted-foreground)]">For footage with your camera + the Capital Command interface.</p>
        <div className="grid grid-cols-2 gap-1.5">
          {LAYOUT_PRESETS.filter((p) => p.id !== "none").map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyLayout(preset.id)}
              title={preset.description}
              className={cn(
                "rounded-md border px-2 py-1.5 text-left text-[11px] transition",
                clip.layoutPreset === preset.id
                  ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      {/* Camera overlay */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Camera overlay</h3>
          <button
            type="button"
            onClick={() => updateClip({ camera: { ...clip.camera, enabled: !clip.camera.enabled } }, true)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs transition",
              clip.camera.enabled ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--border)] text-[var(--muted-foreground)]"
            )}
          >
            {clip.camera.enabled ? "On" : "Off"}
          </button>
        </div>
        {clip.camera.enabled && (
          <Field label={`Corner radius · ${clip.camera.radius}px`}>
            <Slider
              value={clip.camera.radius}
              min={0}
              max={50}
              step={1}
              onLive={(v) => updateClip({ camera: { ...clip.camera, radius: v } }, false)}
              onCommit={(v) => updateClip({ camera: { ...clip.camera, radius: v } }, true)}
            />
          </Field>
        )}
      </section>

      {/* Background */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Background</h3>
        <ButtonRow
          options={[
            { id: "blur", label: "Blurred fill" },
            { id: "color", label: "Colour" }
          ]}
          value={clip.background.type}
          onChange={(type) => updateClip({ background: { ...clip.background, type } }, true)}
        />
        {clip.background.type === "color" && (
          <input
            type="color"
            value={clip.background.color}
            onChange={(e) => updateClip({ background: { ...clip.background, color: e.target.value } }, true)}
            className="h-9 w-full cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface-2)]"
          />
        )}
      </section>
    </div>
  );
}
