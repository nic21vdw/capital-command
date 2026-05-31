'use client'

import { BrainCircuit, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react'
import type { SwingAnalysis, MetricAssessment } from '@/lib/golf/types'
import { cn } from '@/lib/utils'

interface Props {
  analysis: SwingAnalysis | null
  isAnalyzing: boolean
}

const assessmentConfig: Record<
  MetricAssessment,
  { icon: typeof CheckCircle2; color: string; bg: string; label: string }
> = {
  good: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Good' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Watch' },
  needs_work: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Fix' },
  unknown: { icon: HelpCircle, color: 'text-[var(--muted-foreground)]', bg: 'bg-white/6', label: 'N/A' },
}

export function SwingNotesCard({ analysis, isAnalyzing }: Props) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-[var(--panel)] p-6 shadow-xl">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15">
          <BrainCircuit className="h-4 w-4 text-[var(--accent)]" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">Step 4</p>
          <h2 className="text-sm font-semibold text-white">AI Swing Notes</h2>
        </div>
      </div>

      {isAnalyzing && (
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
          <p className="text-sm text-[var(--muted-foreground)]">Analyzing your swing…</p>
        </div>
      )}

      {!isAnalyzing && !analysis && (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <BrainCircuit className="h-10 w-10 text-white/15" />
          <p className="text-sm text-[var(--muted-foreground)]">Upload and analyze a video to see your swing report.</p>
        </div>
      )}

      {!isAnalyzing && analysis && (
        <div className="space-y-6">
          {/* Pose data notice */}
          {!analysis.hasPoseData && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3">
              <p className="text-xs font-medium text-amber-400">
                Pose detection did not find a body in these frames. Ensure good lighting, your full body is
                visible, and the video has a clear background. Analysis below uses fallback coaching notes.
              </p>
            </div>
          )}

          {/* Metrics grid */}
          <div className="grid gap-3 sm:grid-cols-2">
            {analysis.metrics.map((m) => {
              const cfg = assessmentConfig[m.assessment]
              const Icon = cfg.icon
              return (
                <div
                  key={m.name}
                  className={cn('rounded-2xl p-4', cfg.bg, 'border border-white/6')}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', cfg.color)} />
                    <span className={cn('text-xs font-semibold uppercase tracking-wide', cfg.color)}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="mb-1 text-sm font-medium text-white">{m.name}</p>
                  <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{m.description}</p>
                  {m.detail && (
                    <p className="mt-1 text-xs text-white/40">{m.detail}</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Faults */}
          {analysis.faults.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-red-400">Possible Swing Faults</p>
              <ul className="space-y-2">
                {analysis.faults.map((f, i) => (
                  <li key={i} className="flex gap-2 text-xs text-[var(--muted-foreground)]">
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400/70" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tips */}
          {analysis.tips.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">Improvement Tips</p>
              <ul className="space-y-2">
                {analysis.tips.map((t, i) => (
                  <li key={i} className="flex gap-2 text-xs text-[var(--muted-foreground)]">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]/70" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Disclaimer */}
          <p className="rounded-2xl bg-white/4 px-4 py-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
            <strong className="text-white/60">Disclaimer:</strong> This is AI-assisted feedback based on
            automated pose estimation. It is not a replacement for a certified PGA or LPGA golf coach. Use
            this report as a conversation starter — not a definitive diagnosis.
          </p>
        </div>
      )}
    </div>
  )
}
