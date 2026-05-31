'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Dumbbell, Youtube, X } from 'lucide-react'
import type { SwingIssue } from '@/lib/golf/types'
import { cn } from '@/lib/utils'

interface Props {
  issues: SwingIssue[]
  isAnalyzing: boolean
  hasPoseData: boolean
}

const PRIORITY_CONFIG = [
  { badge: '#1', bg: 'bg-red-500/15', border: 'border-red-500/30', text: 'text-red-400', label: 'Top Priority' },
  { badge: '#2', bg: 'bg-amber-500/12', border: 'border-amber-500/25', text: 'text-amber-400', label: 'Important' },
  { badge: '#3', bg: 'bg-sky-500/12', border: 'border-sky-500/25', text: 'text-sky-400', label: 'Also Noted' },
]

function SeverityBar({ value }: { value: number }) {
  const color = value >= 70 ? 'bg-red-500' : value >= 40 ? 'bg-amber-400' : 'bg-sky-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
        <div
          className={cn('h-full rounded-full transition-all duration-700', color)}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right text-[10px] tabular-nums text-[var(--muted-foreground)]">
        {value}
      </span>
    </div>
  )
}

function IssueCard({ issue, expanded, onToggle }: {
  issue: SwingIssue
  expanded: boolean
  onToggle: () => void
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const cfg = PRIORITY_CONFIG[issue.priority - 1]

  return (
    <>
      <div className={cn('overflow-hidden rounded-2xl border', cfg.bg, cfg.border)}>
        {/* Header row */}
        <button
          className="flex w-full items-start gap-4 p-4 text-left"
          onClick={onToggle}
        >
          {/* Priority badge */}
          <span className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black',
            cfg.text, 'bg-current/20',
          )}
            style={{ backgroundColor: 'currentColor' }}
          >
            <span className="text-white text-[10px] font-black">{issue.priority}</span>
          </span>

          {/* Thumbnail + title */}
          <div className="flex flex-1 gap-3 min-w-0">
            {issue.annotatedFrameUrl && (
              <div
                className="relative h-14 w-20 shrink-0 cursor-pointer overflow-hidden rounded-xl bg-black ring-1 ring-white/10"
                onClick={(e) => { e.stopPropagation(); setLightboxOpen(true) }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={issue.annotatedFrameUrl} alt={issue.name} className="h-full w-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition hover:opacity-100">
                  <span className="text-[10px] font-bold text-white">View</span>
                </div>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn('text-[10px] font-bold uppercase tracking-widest', cfg.text)}>
                  {cfg.label}
                </span>
              </div>
              <p className="text-sm font-semibold text-white">{issue.name}</p>
              <SeverityBar value={issue.severity} />
            </div>
          </div>

          {expanded ? (
            <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          ) : (
            <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          )}
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div className="space-y-4 border-t border-white/8 px-4 pb-4 pt-4">
            {/* What AI sees */}
            <div className="rounded-xl border border-white/8 bg-white/4 p-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
                What the AI sees
              </p>
              <p className="text-xs leading-relaxed text-white/80">{issue.whatAISees}</p>
            </div>

            {/* Potential result */}
            <div className="rounded-xl border border-red-500/15 bg-red-500/6 p-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-red-400/70">
                Potential result
              </p>
              <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{issue.potentialResult}</p>
            </div>

            {/* Drills */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                <Dumbbell className="h-3 w-3" />
                Drill Ideas
              </p>
              <div className="space-y-2">
                {issue.drills.map((drill, i) => (
                  <div key={i} className="rounded-xl border border-[var(--accent)]/15 bg-[var(--accent)]/5 p-3">
                    <p className="text-xs font-semibold text-white">{drill.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">&ldquo;{drill.cue}&rdquo;</p>
                  </div>
                ))}
              </div>
            </div>

            {/* YouTube search */}
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(issue.youtubeSearch)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5 text-xs text-[var(--muted-foreground)] transition hover:border-white/16 hover:text-white"
            >
              <Youtube className="h-3.5 w-3.5 shrink-0 text-red-400" />
              Search YouTube: &ldquo;{issue.youtubeSearch}&rdquo;
            </a>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxOpen && issue.annotatedFrameUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setLightboxOpen(false)}
        >
          <div className="relative max-h-[90vh] max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute -right-3 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={issue.annotatedFrameUrl}
              alt={issue.name}
              className="w-full rounded-2xl shadow-2xl"
            />
            <div className="mt-3 rounded-xl bg-black/60 px-4 py-3">
              <p className="text-xs font-semibold text-white">{issue.name}</p>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{issue.whatAISees}</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function PriorityIssuesCard({ issues, isAnalyzing, hasPoseData }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(issues[0]?.id ?? null)

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[var(--panel)] shadow-xl">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/15 ring-1 ring-red-500/20">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <div>
              <span className="rounded-md bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                Step 4
              </span>
              <h2 className="text-sm font-semibold text-white">AI Findings</h2>
            </div>
          </div>
          {issues.length > 0 && (
            <span className="rounded-xl bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400">
              {issues.length} issue{issues.length > 1 ? 's' : ''} found
            </span>
          )}
        </div>
        {issues.length > 0 && (
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Ranked by impact on ball flight. Click a fault to see drills and annotated evidence.
          </p>
        )}
      </div>

      <div className="px-6 pb-6">
        {/* Loading */}
        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center gap-4 py-14">
            <div className="relative">
              <span className="inline-block h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)]" />
              <AlertTriangle className="absolute inset-0 m-auto h-5 w-5 text-[var(--accent)]/60" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white">Detecting swing faults…</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">Analysing body positions across 11 key frames</p>
            </div>
          </div>
        )}

        {/* No pose data */}
        {!isAnalyzing && !hasPoseData && issues.length === 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-4">
            <p className="text-xs font-semibold text-amber-400">Pose detection could not identify a body</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Try better lighting, a plain background, and ensure your full body (head to feet) is visible throughout the swing.
            </p>
          </div>
        )}

        {/* Empty after analysis */}
        {!isAnalyzing && hasPoseData && issues.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/20">
              <AlertTriangle className="h-5 w-5 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-emerald-400">No major faults detected!</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Body positions look solid. Keep working on tempo and consistency.
            </p>
          </div>
        )}

        {/* Issue list */}
        {!isAnalyzing && issues.length > 0 && (
          <div className="space-y-3">
            {issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                expanded={expandedId === issue.id}
                onToggle={() => setExpandedId(expandedId === issue.id ? null : issue.id)}
              />
            ))}

            {/* Disclaimer */}
            <p className="rounded-2xl bg-white/4 px-4 py-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
              <strong className="text-white/50">Disclaimer:</strong> AI-assisted feedback via automated pose estimation.
              Not a replacement for a certified PGA / LPGA golf coach.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
