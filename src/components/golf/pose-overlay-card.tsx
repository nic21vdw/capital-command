'use client'

import { Scan } from 'lucide-react'
import { SWING_PHASES, type FrameWithPose, type SwingPhase } from '@/lib/golf/types'
import { cn } from '@/lib/utils'

interface Props {
  frames: FrameWithPose[]
  activePhase: SwingPhase
  onSelectPhase: (phase: SwingPhase) => void
}

export function PoseOverlayCard({ frames, activePhase, onSelectPhase }: Props) {
  const byPhase = new Map(frames.map((f) => [f.phase, f]))
  const active = byPhase.get(activePhase)
  const detectedCount = frames.filter((f) => f.pose?.detected).length
  const hasAnyFrame = frames.some((f) => f.dataUrl)

  const displayUrl = active?.pose?.overlayDataUrl ?? active?.dataUrl ?? null

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[var(--panel)] shadow-xl">
      {/* Card header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/20">
              <Scan className="h-4 w-4 text-[var(--accent)]" />
            </div>
            <div>
              <span className="rounded-md bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                Step 3
              </span>
              <h2 className="text-sm font-semibold text-white">Pose Overlay</h2>
            </div>
          </div>
          {detectedCount > 0 && (
            <span className="rounded-xl bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400">
              {detectedCount} / 6 detected
            </span>
          )}
        </div>
      </div>

      {/* Phase pills */}
      <div className="flex flex-wrap gap-2 px-6 pb-4">
        {SWING_PHASES.map(({ phase, label }) => {
          const f = byPhase.get(phase)
          const hasOverlay = !!f?.pose?.overlayDataUrl
          const isActive = activePhase === phase
          return (
            <button
              key={phase}
              onClick={() => onSelectPhase(phase)}
              className={cn(
                'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition',
                isActive
                  ? 'bg-[var(--accent)] text-black shadow-sm'
                  : 'bg-white/8 text-[var(--muted-foreground)] hover:bg-white/14 hover:text-white',
              )}
            >
              {label}
              {hasOverlay && (
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  isActive ? 'bg-black/40' : 'bg-emerald-400',
                )} />
              )}
            </button>
          )
        })}
      </div>

      {/* Frame display */}
      <div className="px-6 pb-6">
        <div className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-white/8" style={{ minHeight: 200 }}>
          {active?.processing && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80 backdrop-blur-sm">
              <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
              <p className="text-xs text-[var(--muted-foreground)]">Running pose detection…</p>
            </div>
          )}

          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayUrl} alt={activePhase} className="w-full rounded-2xl" />
          ) : (
            <div className="flex h-56 flex-col items-center justify-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/6 ring-1 ring-white/10">
                <Scan className="h-6 w-6 text-white/25" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-white/40">No frame yet</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {hasAnyFrame
                    ? 'Select a phase above to preview'
                    : 'Click "Analyze Swing" to extract frames and detect pose'}
                </p>
              </div>
            </div>
          )}

          {/* Status badge overlay */}
          {active && !active.processing && displayUrl && (
            <div className="absolute bottom-3 right-3">
              {active.pose?.detected ? (
                <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/25 px-2.5 py-1 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/30 backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Pose detected
                </span>
              ) : active.dataUrl ? (
                <span className="rounded-lg bg-amber-500/25 px-2.5 py-1 text-xs font-semibold text-amber-400 ring-1 ring-amber-500/30 backdrop-blur-sm">
                  No pose found
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-4">
          <span className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <span className="h-2 w-2 rounded-full bg-[#ff5f6d]" />
            Keypoints
          </span>
          <span className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <span className="h-0.5 w-4 rounded bg-[#00e5a0]" />
            Skeleton
          </span>
          <span className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Phase has pose data
          </span>
        </div>
      </div>
    </div>
  )
}
