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

  const displayUrl =
    active?.pose?.overlayDataUrl ?? active?.dataUrl ?? null

  return (
    <div className="rounded-[28px] border border-white/10 bg-[var(--panel)] p-6 shadow-xl">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15">
          <Scan className="h-4 w-4 text-[var(--accent)]" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">Step 3</p>
          <h2 className="text-sm font-semibold text-white">Pose Overlay</h2>
        </div>
      </div>

      {/* Phase pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {SWING_PHASES.map(({ phase, label }) => {
          const f = byPhase.get(phase)
          const hasOverlay = !!f?.pose?.overlayDataUrl
          return (
            <button
              key={phase}
              onClick={() => onSelectPhase(phase)}
              className={cn(
                'rounded-xl px-3 py-1.5 text-xs font-medium transition',
                activePhase === phase
                  ? 'bg-[var(--accent)] text-black'
                  : 'bg-white/8 text-[var(--muted-foreground)] hover:bg-white/14 hover:text-white',
              )}
            >
              {label}
              {hasOverlay && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          )
        })}
      </div>

      {/* Frame display */}
      <div className="relative overflow-hidden rounded-2xl bg-black" style={{ minHeight: 200 }}>
        {active?.processing && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
            <p className="text-xs text-[var(--muted-foreground)]">Running pose detection…</p>
          </div>
        )}

        {displayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrl}
            alt={activePhase}
            className="w-full rounded-2xl"
          />
        ) : (
          <div className="flex h-48 items-center justify-center">
            <div className="text-center">
              <Scan className="mx-auto mb-2 h-8 w-8 text-white/20" />
              <p className="text-xs text-[var(--muted-foreground)]">
                Analyze swing to see pose overlay
              </p>
            </div>
          </div>
        )}

        {/* Pose status badge */}
        {active && !active.processing && (
          <div className="absolute bottom-3 right-3">
            {active.pose?.detected ? (
              <span className="rounded-lg bg-emerald-500/20 px-2 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/30">
                Pose detected
              </span>
            ) : active.dataUrl ? (
              <span className="rounded-lg bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-400 ring-1 ring-amber-500/30">
                No pose found
              </span>
            ) : null}
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-[var(--muted-foreground)]">
        Green dots = keypoints &middot; Teal lines = skeleton &middot; Select a phase above to inspect
      </p>
    </div>
  )
}
