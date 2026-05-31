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
  { icon: typeof CheckCircle2; color: string; bg: string; border: string; label: string }
> = {
  good: {
    icon: CheckCircle2,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/8',
    border: 'border-emerald-500/20',
    label: 'Good',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/8',
    border: 'border-amber-500/20',
    label: 'Watch',
  },
  needs_work: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/8',
    border: 'border-red-500/20',
    label: 'Fix',
  },
  unknown: {
    icon: HelpCircle,
    color: 'text-[var(--muted-foreground)]',
    bg: 'bg-white/4',
    border: 'border-white/8',
    label: 'N/A',
  },
}

function ScoreSummary({ metrics }: { metrics: SwingAnalysis['metrics'] }) {
  const good = metrics.filter((m) => m.assessment === 'good').length
  const warn = metrics.filter((m) => m.assessment === 'warning').length
  const fix = metrics.filter((m) => m.assessment === 'needs_work').length
  const total = metrics.filter((m) => m.assessment !== 'unknown').length

  const score = total > 0 ? Math.round((good / total) * 100) : 0

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-white/8 bg-white/4 px-5 py-4">
      {/* Score circle */}
      <div className="flex flex-col items-center">
        <p
          className={cn(
            'text-3xl font-bold tabular-nums',
            score >= 70 ? 'text-emerald-400' : score >= 45 ? 'text-amber-400' : 'text-red-400',
          )}
        >
          {score}
        </p>
        <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)]">Score</p>
      </div>

      <div className="h-12 w-px bg-white/8" />

      {/* Breakdown */}
      <div className="flex flex-1 gap-4">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-lg font-bold text-emerald-400">{good}</span>
          <span className="text-[10px] text-[var(--muted-foreground)]">Good</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-lg font-bold text-amber-400">{warn}</span>
          <span className="text-[10px] text-[var(--muted-foreground)]">Watch</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-lg font-bold text-red-400">{fix}</span>
          <span className="text-[10px] text-[var(--muted-foreground)]">Fix</span>
        </div>
      </div>

      {/* Score bar */}
      <div className="flex-1">
        <div className="h-2 overflow-hidden rounded-full bg-white/8">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              score >= 70 ? 'bg-emerald-400' : score >= 45 ? 'bg-amber-400' : 'bg-red-400',
            )}
            style={{ width: `${score}%` }}
          />
        </div>
        <p className="mt-1.5 text-right text-[10px] text-[var(--muted-foreground)]">
          {good} of {total} metrics passing
        </p>
      </div>
    </div>
  )
}

export function SwingNotesCard({ analysis, isAnalyzing }: Props) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[var(--panel)] shadow-xl">
      {/* Card header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/20">
            <BrainCircuit className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div>
            <span className="rounded-md bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
              Step 4
            </span>
            <h2 className="text-sm font-semibold text-white">AI Swing Notes</h2>
          </div>
        </div>
      </div>

      <div className="px-6 pb-6">
        {/* Loading */}
        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center gap-4 py-14">
            <div className="relative">
              <span className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)] inline-block" />
              <BrainCircuit className="absolute inset-0 m-auto h-5 w-5 text-[var(--accent)]/60" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white">Analyzing your swing…</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">Measuring 8 biomechanical metrics</p>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isAnalyzing && !analysis && (
          <div className="flex flex-col items-center justify-center gap-4 py-14">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/6 ring-1 ring-white/10">
              <BrainCircuit className="h-6 w-6 text-white/25" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white/60">Report not generated yet</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Upload a video and click <strong className="text-white/50">Analyze Swing</strong> to see your 8-metric report
              </p>
            </div>
          </div>
        )}

        {/* Analysis results */}
        {!isAnalyzing && analysis && (
          <div className="space-y-6">
            {/* Score summary */}
            <ScoreSummary metrics={analysis.metrics} />

            {/* Pose fallback warning */}
            {!analysis.hasPoseData && (
              <div className="flex gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p className="text-xs leading-relaxed text-amber-300/80">
                  Pose detection could not find a body in these frames. Ensure good lighting, your full body
                  is visible, and the camera is stable. The metrics below show fallback guidance.
                </p>
              </div>
            )}

            {/* Metrics grid */}
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
                Biomechanical Metrics
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {analysis.metrics.map((m) => {
                  const cfg = assessmentConfig[m.assessment]
                  const Icon = cfg.icon
                  return (
                    <div
                      key={m.name}
                      className={cn('rounded-2xl border p-4', cfg.bg, cfg.border)}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <Icon className={cn('h-3.5 w-3.5 shrink-0', cfg.color)} />
                        <span className={cn('text-[10px] font-bold uppercase tracking-widest', cfg.color)}>
                          {cfg.label}
                        </span>
                      </div>
                      <p className="mb-1 text-sm font-semibold text-white">{m.name}</p>
                      <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{m.description}</p>
                      {m.detail && (
                        <p className="mt-1.5 text-[10px] font-medium text-white/35">{m.detail}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Faults */}
            {analysis.faults.length > 0 && (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-red-400">
                  Possible Swing Faults
                </p>
                <div className="space-y-2">
                  {analysis.faults.map((f, i) => (
                    <div key={i} className="flex gap-3 rounded-2xl border border-red-500/15 bg-red-500/6 px-4 py-3">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400/70" />
                      <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{f}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tips */}
            {analysis.tips.length > 0 && (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
                  Improvement Tips
                </p>
                <div className="space-y-2">
                  {analysis.tips.map((t, i) => (
                    <div key={i} className="flex gap-3 rounded-2xl border border-[var(--accent)]/15 bg-[var(--accent)]/6 px-4 py-3">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]/70" />
                      <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{t}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <div className="flex gap-3 rounded-2xl bg-white/4 px-4 py-3">
              <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                <strong className="text-white/50">Disclaimer:</strong> AI-assisted feedback via automated
                pose estimation. Not a replacement for a certified PGA / LPGA golf coach. Use this as a
                conversation starter — not a diagnosis.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
