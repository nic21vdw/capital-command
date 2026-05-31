'use client'

import { MessageSquareQuote, Copy, Check, Star } from 'lucide-react'
import { useState } from 'react'
import type { SwingAnalysisV2 } from '@/lib/golf/types'

interface Props {
  analysis: SwingAnalysisV2 | null
  isAnalyzing: boolean
}

export function LessonQuestionsCard({ analysis, isAnalyzing }: Props) {
  const [copied, setCopied] = useState(false)
  const questions = analysis?.lessonQuestions ?? []

  const handleCopy = async () => {
    const text = questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-[var(--accent)]/20 bg-[var(--panel)] shadow-xl shadow-[var(--accent)]/5">
      <div className="h-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />

      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/20 ring-1 ring-[var(--accent)]/30">
              <MessageSquareQuote className="h-4 w-4 text-[var(--accent)]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                  Step 7
                </span>
                <span className="flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                  <Star className="h-2.5 w-2.5 fill-amber-400" />
                  Killer feature
                </span>
              </div>
              <h2 className="text-sm font-semibold text-white">Questions to Ask Your Coach</h2>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                Generated from your swing data — not generic advice
              </p>
            </div>
          </div>
          {questions.length > 0 && (
            <button
              onClick={handleCopy}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/8 px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition hover:border-white/20 hover:text-white"
            >
              {copied ? (
                <><Check className="h-3.5 w-3.5 text-emerald-400" />Copied!</>
              ) : (
                <><Copy className="h-3.5 w-3.5" />Copy all</>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="px-6 pb-6">
        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center gap-4 py-10">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)]" />
            <p className="text-sm text-[var(--muted-foreground)]">Generating lesson questions…</p>
          </div>
        )}

        {!isAnalyzing && questions.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/8 ring-1 ring-[var(--accent)]/15">
              <MessageSquareQuote className="h-6 w-6 text-[var(--accent)]/40" />
            </div>
            <div>
              <p className="text-sm font-medium text-white/60">Questions appear after analysis</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
                These are personalised to your swing faults — they make your next lesson 10× more productive.
              </p>
            </div>
          </div>
        )}

        {!isAnalyzing && questions.length > 0 && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--accent)]/15 bg-[var(--accent)]/6 px-4 py-3">
              <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--accent)]">Why this matters:</span>{' '}
                Most golfers walk into a lesson without knowing what to ask. These questions are built
                from your detected swing faults so your coach can focus on what actually needs fixing.
              </p>
            </div>

            <div className="space-y-2.5">
              {questions.map((q, i) => (
                <div
                  key={i}
                  className="group flex gap-3.5 rounded-2xl border border-white/6 bg-white/3 p-4 transition hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/20 text-[10px] font-bold text-[var(--accent)]">
                    {i + 1}
                  </span>
                  <p className="text-sm leading-relaxed text-white/80 group-hover:text-white">
                    &ldquo;{q}&rdquo;
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-white/6 bg-white/4 px-4 py-3">
              <p className="text-xs text-[var(--muted-foreground)]">Save before your lesson</p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)]/15 px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/25"
              >
                {copied ? <><Check className="h-3 w-3" />Copied</> : <><Copy className="h-3 w-3" />Copy to clipboard</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
