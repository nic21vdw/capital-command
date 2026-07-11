"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Play, RotateCcw, Square, Upload } from "lucide-react";
import { toast } from "sonner";
import { RangeField, SelectField, Toggle } from "@/components/editor/controls";
import { SFX_SOUNDS, defaultSfxSettings } from "@/lib/sfx/types";
import type { SfxSettings, SfxSoundId } from "@/types/domain";

// The shared "Viral sound effects" card used by both the Clip Editor's Audio
// panel and the Long-Form Editor's Audio panel. The settings themselves live
// on the project (each editor persists its own); the sound files behind the
// three slots are app-wide, managed here through /api/sfx. Effects are baked
// into the export by the render pipelines — this card is the control surface.

type SoundStatus = {
  id: SfxSoundId;
  custom: { fileName: string; updatedAt: string } | null;
};

const SENSITIVITY_OPTIONS = [
  { value: "subtle", label: "Subtle — only the biggest moments" },
  { value: "balanced", label: "Balanced — the highlights" },
  { value: "aggressive", label: "Aggressive — meme every beat" }
] as const;

export function SfxSection({
  value,
  onChange
}: {
  value: SfxSettings | undefined;
  onChange: (next: SfxSettings) => void;
}) {
  const sfx = value ?? defaultSfxSettings();
  const set = (partial: Partial<SfxSettings>) => onChange({ ...sfx, ...partial });
  const setSound = (id: SfxSoundId, enabled: boolean) => set({ sounds: { ...sfx.sounds, [id]: enabled } });

  const [status, setStatus] = useState<SoundStatus[]>([]);
  const [uploadingId, setUploadingId] = useState<SfxSoundId | null>(null);
  const [auditionId, setAuditionId] = useState<SfxSoundId | null>(null);
  const auditionRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickingForRef = useRef<SfxSoundId | null>(null);

  const refresh = async () => {
    try {
      const response = await fetch("/api/sfx", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { sounds?: SoundStatus[] };
      if (Array.isArray(data.sounds)) setStatus(data.sounds);
    } catch {
      // The card still works without the status list; slots just read as stand-ins.
    }
  };

  // Initial status load; failures stay silent — slots just read as stand-ins.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/sfx", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { sounds?: SoundStatus[] } | null) => {
        if (!cancelled && data && Array.isArray(data.sounds)) setStatus(data.sounds);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Stop the audition player when the card unmounts.
  useEffect(() => () => auditionRef.current?.pause(), []);

  const customOf = (id: SfxSoundId) => status.find((item) => item.id === id)?.custom ?? null;

  const toggleAudition = (id: SfxSoundId) => {
    const el = auditionRef.current;
    if (!el) return;
    if (auditionId === id) {
      el.pause();
      setAuditionId(null);
      return;
    }
    // Cache-bust with the upload stamp so a fresh MP3 plays immediately.
    const stamp = customOf(id)?.updatedAt ?? "default";
    el.src = `/api/sfx/${id}?v=${encodeURIComponent(stamp)}`;
    void el.play().then(() => setAuditionId(id)).catch(() => setAuditionId(null));
  };

  const pickFile = (id: SfxSoundId) => {
    pickingForRef.current = id;
    fileRef.current?.click();
  };

  const onFilePicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const id = pickingForRef.current;
    event.target.value = "";
    if (!file || !id) return;
    setUploadingId(id);
    try {
      const response = await fetch(`/api/sfx/${id}?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "audio/mpeg" },
        body: file
      });
      const data = (await response.json()) as { sound?: unknown; error?: string };
      if (!response.ok || !data.sound) {
        toast.error(data.error ?? "Could not save that sound.");
        return;
      }
      toast.success(`“${file.name}” now plays for that effect.`);
      await refresh();
    } catch {
      toast.error("Upload failed. Is the dev server still running?");
    } finally {
      setUploadingId(null);
    }
  };

  const resetSound = async (id: SfxSoundId) => {
    try {
      await fetch(`/api/sfx/${id}`, { method: "DELETE" });
      await refresh();
    } catch {
      toast.error("Could not reset that sound.");
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
      <div>
        <Toggle label="Auto sound effects" checked={sfx.enabled} onChange={(v) => set({ enabled: v })} />
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Drops viral sounds right after your most important lines — planned from the captions and baked into the
          export. Upload your own MP3 for any slot; until then a stand-in approximation plays.
        </p>
      </div>

      {sfx.enabled && (
        <>
          <SelectField
            label="How often"
            value={sfx.sensitivity}
            onChange={(v) => set({ sensitivity: v })}
            options={[...SENSITIVITY_OPTIONS]}
          />
          <RangeField
            label="Effect volume"
            value={sfx.volume}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => set({ volume: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />

          <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(event) => void onFilePicked(event)} />

          <div className="space-y-2">
            {SFX_SOUNDS.map((sound) => {
              const custom = customOf(sound.id);
              const uploading = uploadingId === sound.id;
              return (
                <div key={sound.id} className="rounded-lg border border-[var(--border)] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Toggle
                      label={sound.label}
                      checked={sfx.sounds[sound.id]}
                      onChange={(v) => setSound(sound.id, v)}
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleAudition(sound.id)}
                        className="rounded-md border border-[var(--border)] p-1.5 text-[var(--muted-foreground)] transition hover:text-white"
                        aria-label={auditionId === sound.id ? `Stop ${sound.label}` : `Play ${sound.label}`}
                      >
                        {auditionId === sound.id ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => !uploading && pickFile(sound.id)}
                        className="rounded-md border border-[var(--border)] p-1.5 text-[var(--muted-foreground)] transition hover:text-white"
                        aria-label={`Upload MP3 for ${sound.label}`}
                      >
                        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      </button>
                      {custom && (
                        <button
                          type="button"
                          onClick={() => void resetSound(sound.id)}
                          className="rounded-md border border-[var(--border)] p-1.5 text-[var(--muted-foreground)] transition hover:text-white"
                          aria-label={`Reset ${sound.label} to the stand-in sound`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                    {custom ? `Playing your “${custom.fileName}”` : sound.description}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Hidden audition player for previewing the slot sounds. */}
      <audio ref={auditionRef} hidden onEnded={() => setAuditionId(null)} />
    </div>
  );
}
