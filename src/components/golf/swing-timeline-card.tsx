'use client'

import { Film, Info } from 'lucide-react'
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

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[var(--panel)] shadow-xl">
      {/* Card header */}
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
              {extractedCount} / 6 frames
            </span>
          )}
        </div>

        {/* Instruction callout */}
        <div className="mt-3 flex gap-2.5 rounded-2xl border border-white/6 bg-white/4 px-4 py-3">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            Each row represents a moment in your swing. <strong className="text-white/70">Drag the slider</strong> to
            fine-tune the timestamp, then hit <strong className="text-white/70">Analyze Swing</strong> to extract the frame at that exact point.
          </p>
        </div>
      </div>

      {/* Phase rows */}
      <div className="px-6 pb-6 space-y-2">
        {SWING_PHASES.map(({ phase, label, description }, idx) => {
          const frame = byPhase.get(phase)
          const isActive = activePhase === phase
          const hasPose = !!frame?.pose?.detected

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
              {/* Phase number */}
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  isActive ? 'bg-[var(--accent)] text-black' : 'bg-white/8 text-white/40',
                )}
              >
                {idx + 1}
              </span>

              {/* Thumbnail */}
              <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-xl bg-white/6 ring-1 ring-white/8">
                {frame?.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={frame.dataUrl} alt={label} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Film className="h-4 w-4 text-white/20" />
                  </div>
                )}
                {frame?.processing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
                  </div>
                )}
                {hasPose && (
                  <span className="absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-black" />
                )}
              </div>

              {/* Label + description */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{description}</p>
              </div>

              {/* Timestamp slider */}
              {videoDuration > 0 && (
                <div
                  className="flex shrink-0 flex-col items-end gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="range"
                    min={0}
                    max={videoDuration}
                    step={0.05}
                    value={frame?.timestamp ?? 0}
                    onChange={(e) => onTimestampChange(phase, parseFloat(e.target.value))}
                    className="h-1 w-24 cursor-pointer accent-[color:var(--accent)]"
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
  )
}
