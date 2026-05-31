'use client'

import { Film } from 'lucide-react'
import { SWING_PHASES, type FrameWithPose, type SwingPhase } from '@/lib/golf/types'
import { cn } from '@/lib/utils'

interface Props {
  frames: FrameWithPose[]
  activePhase: SwingPhase
  onSelectPhase: (phase: SwingPhase) => void
  videoDuration: number
  onTimestampChange: (phase: SwingPhase, seconds: number) => void
}

export function SwingTimelineCard({
  frames,
  activePhase,
  onSelectPhase,
  videoDuration,
  onTimestampChange,
}: Props) {
  const byPhase = new Map(frames.map((f) => [f.phase, f]))

  return (
    <div className="rounded-[28px] border border-white/10 bg-[var(--panel)] p-6 shadow-xl">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15">
          <Film className="h-4 w-4 text-[var(--accent)]" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">Step 2</p>
          <h2 className="text-sm font-semibold text-white">Swing Frame Timeline</h2>
        </div>
      </div>

      <div className="space-y-3">
        {SWING_PHASES.map(({ phase, label, description }) => {
          const frame = byPhase.get(phase)
          const isActive = activePhase === phase

          return (
            <div
              key={phase}
              onClick={() => onSelectPhase(phase)}
              className={cn(
                'group flex cursor-pointer items-center gap-4 rounded-2xl border p-3 transition',
                isActive
                  ? 'border-[var(--accent)]/40 bg-[var(--accent)]/8'
                  : 'border-white/6 hover:border-white/14 hover:bg-white/4',
              )}
            >
              {/* Thumbnail */}
              <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-xl bg-white/6">
                {frame?.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={frame.dataUrl} alt={label} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Film className="h-5 w-5 text-white/20" />
                  </div>
                )}
                {frame?.processing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{label}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{description}</p>
              </div>

              {/* Time slider */}
              {videoDuration > 0 && (
                <div
                  className="flex shrink-0 flex-col items-end gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="range"
                    min={0}
                    max={videoDuration}
                    step={0.1}
                    value={frame?.timestamp ?? 0}
                    onChange={(e) => onTimestampChange(phase, parseFloat(e.target.value))}
                    className="h-1 w-24 cursor-pointer accent-[color:var(--accent)]"
                  />
                  <p className="text-xs tabular-nums text-[var(--muted-foreground)]">
                    {(frame?.timestamp ?? 0).toFixed(1)}s
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
