'use client'

import { MessageSquareQuote, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import type { SwingAnalysis } from '@/lib/golf/types'

interface Props {
  analysis: SwingAnalysis | null
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
    <div className="rounded-[28px] border border-white/10 bg-[var(--panel)] p-6 shadow-xl">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15">
            <MessageSquareQuote className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">Step 5</p>
            <h2 className="text-sm font-semibold text-white">Lesson Questions</h2>
          </div>
        </div>
        {questions.length > 0 && (
          <button
            onClick={handleCopy}
            className="flex h-8 items-center gap-1.5 rounded-xl bg-white/8 px-3 text-xs text-[var(--muted-foreground)] transition hover:bg-white/14 hover:text-white"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy all
              </>
            )}
          </button>
        )}
      </div>

      {isAnalyzing && (
        <div className="flex flex-col items-center justify-center gap-4 py-10">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
          <p className="text-sm text-[var(--muted-foreground)]">Generating lesson questions…</p>
        </div>
      )}

      {!isAnalyzing && questions.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-10">
          <MessageSquareQuote className="h-9 w-9 text-white/15" />
          <p className="text-sm text-[var(--muted-foreground)]">
            Personalized questions appear after analysis.
          </p>
        </div>
      )}

      {!isAnalyzing && questions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            Bring these questions to your next lesson — they turn AI feedback into a productive
            coaching conversation.
          </p>
          <div className="space-y-2.5">
            {questions.map((q, i) => (
              <div
                key={i}
                className="flex gap-3 rounded-2xl border border-white/6 bg-white/4 p-4 transition hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/20 text-xs font-semibold text-[var(--accent)]">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed text-white/85">&ldquo;{q}&rdquo;</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Tap &ldquo;Copy all&rdquo; to paste into your notes app before heading to the course.
          </p>
        </div>
      )}
    </div>
  )
}
