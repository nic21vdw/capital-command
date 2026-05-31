'use client'

import { useState } from 'react'
import { Film, Info, X } from 'lucide-react'
import { SWING_PHASES, type FrameWithPose, type SwingPhase } from '@/lib/golf/types'
import { cn } from '@/lib/utils'

interface Props {
  frames: FrameWithPose[]
  activePhase: SwingPhase
  onSelectPhase: (phase: SwingPhase) => void
  videoDuration: number
  onTimestampChange: (phase: SwingPhase, seconds: number) => void
  hasRun: boolean
}

export function SwingTimelineCard({
  frames,
  activePhase,
  onSelectPhase,
  videoDuration,
  onTimestampChange,
  hasRun,
}: Props) {
  const byPhase = new Map(frames.map((f) => [f.phase, f]))
  const extractedCount = frames.filter((f) => f.dataUrl).length
  const [lightboxPhase, setLightboxPhase] = useState<SwingPhase | null>(null)
  const lightboxFrame = lightboxPhase ? byPhase.get(lightboxPhase) : null

  return (
    <>
      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[var(--panel)] shadow-xl">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/20">
                <Film className="h-4 w-4 text-[var(--accent)]" />
              </div>
              <div>
                <span className="rounded-md bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                  Step 2
                </span>
                <h2 className="text-sm font-semibold text-white">Swing Frame Timeline</h2>
              </div>
            </div>
            {hasRun && extractedCount > 0 && (
              <span className="shrink-0 rounded-xl bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400">
                {extractedCount} / {SWING_PHASES.length}
              </span>
            )}
          </div>

          <div className="mt-3 flex gap-2.5 rounded-2xl border border-white/6 bg-white/4 px-4 py-3">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
            <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
              11 swing positions are auto-detected. <strong className="text-white/70">Drag the slider</strong> to
              fine-tune each timestamp, then <strong className="text-white/70">Analyze Swing</strong>.
              Click any thumbnail to expand it.
            </p>
          </div>
        </div>

        {/* Phase rows */}
        <div className="px-6 pb-6 space-y-2">
          {SWING_PHASES.map(({ phase, label, description }, idx) => {
            const frame = byPhase.get(phase)
            const isActive = activePhase === phase
            const hasPose = !!frame?.pose?.detected
            const hasAnnotation = !!frame?.annotatedUrl

            return (
              <div
                key={phase}
                onClick={() => onSelectPhase(phase)}
                className={cn(
                  'group flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition',
                  isActive
                    ? 'border-[var(--accent)]/40 bg-[var(--accent)]/8 shadow-sm shadow-[var(--accent)]/10'
                    : 'border-white/6 hover:border-white/14 hover:bg-white/4',
                )}
              >
                {/* Index */}
                <span className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  isActive ? 'bg-[var(--accent)] text-black' : 'bg-white/8 text-white/40',
                )}>
                  {idx + 1}
                </span>

                {/* Thumbnail */}
                <div
                  className="relative h-11 w-18 shrink-0 overflow-hidden rounded-xl bg-white/6 ring-1 ring-white/8"
                  style={{ width: 72 }}
                  onClick={(e) => {
                    if (frame?.dataUrl) { e.stopPropagation(); setLightboxPhase(phase) }
                  }}
                >
                  {frame?.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={frame.annotatedUrl ?? frame.pose?.overlayDataUrl ?? frame.dataUrl}
                      alt={label}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Film className="h-3.5 w-3.5 text-white/20" />
                    </div>
                  )}
                  {frame?.processing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
                    </div>
                  )}
                  {/* Badges */}
                  {hasAnnotation && (
                    <span className="absolute bottom-0.5 left-0.5 h-2 w-2 rounded-full bg-red-400 ring-1 ring-black" title="Has fault annotation" />
                  )}
                  {hasPose && !hasAnnotation && (
                    <span className="absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-black" title="Pose detected" />
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{label}</p>
                  <p className="text-[10px] text-[var(--muted-foreground)]">{description}</p>
                </div>

                {/* Slider */}
                {videoDuration > 0 && (
                  <div
                    className="flex shrink-0 flex-col items-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="range"
                      min={0}
                      max={videoDuration}
                      step={0.05}
                      value={frame?.timestamp ?? 0}
                      onChange={(e) => onTimestampChange(phase, parseFloat(e.target.value))}
                      className="h-1 w-20 cursor-pointer accent-[color:var(--accent)]"
                    />
                    <p className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                      {(frame?.timestamp ?? 0).toFixed(2)}s
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Frame lightbox */}
      {lightboxFrame && lightboxPhase && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setLightboxPhase(null)}
        >
          <div className="relative max-h-[90vh] max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightboxPhase(null)}
              className="absolute -right-3 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxFrame.annotatedUrl ?? lightboxFrame.pose?.overlayDataUrl ?? lightboxFrame.dataUrl}
              alt={lightboxPhase}
              className="w-full rounded-2xl shadow-2xl"
            />
            <div className="mt-3 flex justify-between rounded-xl bg-black/60 px-4 py-2">
              <p className="text-xs font-semibold text-white capitalize">
                {lightboxPhase.replace(/_/g, ' ')}
              </p>
              <div className="flex gap-3">
                {lightboxFrame.pose?.detected && (
                  <span className="text-xs text-emerald-400">Pose detected</span>
                )}
                {lightboxFrame.annotatedUrl && (
                  <span className="text-xs text-red-400">Fault annotated</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
