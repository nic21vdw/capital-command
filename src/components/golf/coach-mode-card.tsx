'use client'

import { useState } from 'react'
import { GraduationCap, ChevronDown, ChevronUp, Dumbbell, Youtube } from 'lucide-react'
import type { SwingAnalysisV2, CoachPlanItem } from '@/lib/golf/types'
import { cn } from '@/lib/utils'

interface Props {
  analysis: SwingAnalysisV2 | null
}

function PlanItem({ item, index }: { item: CoachPlanItem; index: number }) {
  const [open, setOpen] = useState(index === 0)

  return (
    <div className="overflow-hidden rounded-2xl border border-white/8 bg-white/3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/20 text-xs font-bold text-[var(--accent)]">
          {index + 1}
        </span>
        <p className="flex-1 text-sm font-semibold text-white">{item.name}</p>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-white/8 px-4 pb-4 pt-4">
          {/* Annotated frame */}
          {item.primaryFrameUrl && (
            <div className="overflow-hidden rounded-xl bg-black ring-1 ring-white/8" style={{ maxHeight: 180 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.primaryFrameUrl} alt={item.name} className="w-full object-contain" />
            </div>
          )}

          {/* Problem */}
          <div className="rounded-xl border border-white/8 bg-white/4 p-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">Problem</p>
            <p className="text-xs leading-relaxed text-white/80">{item.problem}</p>
          </div>

          {/* Evidence */}
          <div className="flex items-center gap-2 rounded-xl bg-white/4 px-3 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            <p className="text-xs text-[var(--muted-foreground)]">{item.evidence}</p>
          </div>

          {/* Drills */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
              <Dumbbell className="h-3 w-3" />
              Drill Recommendations
            </p>
            <div className="space-y-2">
              {item.drills.map((drill, i) => (
                <div key={i} className="rounded-xl border border-[var(--accent)]/15 bg-[var(--accent)]/6 p-3">
                  <p className="text-xs font-semibold text-white">{drill.name}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">&ldquo;{drill.cue}&rdquo;</p>
                </div>
              ))}
            </div>
          </div>

          {/* YouTube */}
          <a
            href={`https://www.youtube.com/results?search_query=${encodeURIComponent(item.youtubeSearch)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5 text-xs text-[var(--muted-foreground)] transition hover:border-white/16 hover:text-white"
          >
            <Youtube className="h-3.5 w-3.5 shrink-0 text-red-400" />
            YouTube: &ldquo;{item.youtubeSearch}&rdquo;
          </a>

          {/* Expected improvement */}
          <div className="flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            <p className="text-xs leading-relaxed text-emerald-300/80">
              <strong className="text-emerald-400">Expected improvement:</strong> {item.expectedImprovement}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export function CoachModeCard({ analysis }: Props) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[var(--panel)] shadow-xl">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/20">
            <GraduationCap className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div>
            <span className="rounded-md bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
              Step 6
            </span>
            <h2 className="text-sm font-semibold text-white">Coach Mode</h2>
            <p className="text-xs text-[var(--muted-foreground)]">Full lesson plan per identified issue</p>
          </div>
        </div>
      </div>

      <div className="px-6 pb-6">
        {!analysis ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)]/8 ring-1 ring-[var(--accent)]/15">
              <GraduationCap className="h-5 w-5 text-[var(--accent)]/40" />
            </div>
            <div>
              <p className="text-sm font-medium text-white/60">Lesson plan generates after analysis</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Each detected fault gets a problem description, evidence frame, drills, YouTube search, and expected result.
              </p>
            </div>
          </div>
        ) : analysis.coachPlanItems.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-semibold text-emerald-400">No issues to plan for — keep practising!</p>
            <p className="text-xs text-[var(--muted-foreground)]">Focus on consistency and tempo.</p>
          </div>
        ) : (
          <div className={cn('space-y-3')}>
            {analysis.coachPlanItems.map((item, i) => (
              <PlanItem key={item.issueId} item={item} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
