'use client'

import { useState, useCallback } from 'react'
import { Play, RotateCcw, Loader2, CheckCircle2, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

import type { FrameWithPose, SwingPhase, SwingAnalysis } from '@/lib/golf/types'
import { SWING_PHASES } from '@/lib/golf/types'
import { buildInitialFrames, extractFrameAtTime } from '@/lib/golf/frame-extractor'
import { analyzeSwing } from '@/lib/golf/swing-analyzer'

import { VideoUploadCard } from './video-upload-card'
import { SwingTimelineCard } from './swing-timeline-card'
import { PoseOverlayCard } from './pose-overlay-card'
import { SwingNotesCard } from './swing-notes-card'
import { LessonQuestionsCard } from './lesson-questions-card'

const STEPS = [
  { n: 1, label: 'Upload Video' },
  { n: 2, label: 'Set Frame Times' },
  { n: 3, label: 'Analyze Swing' },
  { n: 4, label: 'Review Notes' },
  { n: 5, label: 'Coach Questions' },
]

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STEPS.map(({ n, label }, i) => {
        const done = current > n
        const active = current === n
        return (
          <div key={n} className="flex items-center gap-1">
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap transition',
                done && 'bg-emerald-500/15 text-emerald-400',
                active && 'bg-[var(--accent)]/20 text-[var(--accent)]',
                !done && !active && 'text-[var(--muted-foreground)]',
              )}
            >
              {done ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold',
                    active ? 'bg-[var(--accent)] text-black' : 'bg-white/10 text-white/40',
                  )}
                >
                  {n}
                </span>
              )}
              {label}
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight className="h-3 w-3 shrink-0 text-white/20" />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function GolfSwingPage() {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [frames, setFrames] = useState<FrameWithPose[]>([])
  const [activePhase, setActivePhase] = useState<SwingPhase>('address')
  const [analysis, setAnalysis] = useState<SwingAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [hasRun, setHasRun] = useState(false)

  // Derive which step the user is on for the progress bar
  const currentStep = analysis
    ? 4
    : isAnalyzing
      ? 3
      : videoUrl
        ? 2
        : 1

  const handleVideoSelected = useCallback((file: File, url: string) => {
    setVideoFile(file)
    setVideoUrl(url)
    setAnalysis(null)
    setHasRun(false)
    setFrames([])
    setVideoDuration(0)

    const tmpVid = document.createElement('video')
    tmpVid.src = url
    tmpVid.preload = 'metadata'
    tmpVid.onloadedmetadata = () => {
      const dur = tmpVid.duration || 10
      setVideoDuration(dur)
      setFrames(buildInitialFrames(dur))
    }
  }, [])

  const handleClear = useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(null)
    setVideoUrl(null)
    setVideoDuration(0)
    setFrames([])
    setAnalysis(null)
    setHasRun(false)
  }, [videoUrl])

  const handleTimestampChange = useCallback((phase: SwingPhase, seconds: number) => {
    setFrames((prev) =>
      prev.map((f) => (f.phase === phase ? { ...f, timestamp: seconds, dataUrl: '', pose: null } : f)),
    )
  }, [])

  const runAnalysis = useCallback(async () => {
    if (!videoUrl || frames.length === 0) return
    setIsAnalyzing(true)
    setAnalysis(null)

    const vid = document.createElement('video')
    vid.src = videoUrl
    vid.crossOrigin = 'anonymous'
    vid.preload = 'auto'
    await new Promise<void>((res) => {
      vid.onloadeddata = () => res()
      vid.load()
    })

    const updatedFrames: FrameWithPose[] = frames.map((f) => ({ ...f, processing: true }))
    setFrames([...updatedFrames])

    for (const { phase } of SWING_PHASES) {
      const frame = updatedFrames.find((f) => f.phase === phase)!
      try {
        const dataUrl = await extractFrameAtTime(vid, frame.timestamp)
        frame.dataUrl = dataUrl
        frame.processing = false
        setFrames([...updatedFrames])
      } catch {
        frame.dataUrl = ''
        frame.processing = false
        frame.error = 'Frame extraction failed'
      }
    }

    toast.info('Running pose detection…', { duration: 3000 })
    let detectPose: ((url: string) => Promise<import('@/lib/golf/types').PoseResult>) | null = null
    try {
      const mod = await import('@/lib/golf/pose-detector')
      detectPose = mod.detectPoseInFrame
    } catch {
      toast.warning('Pose detection library failed to load. Showing frames only.')
    }

    for (const { phase } of SWING_PHASES) {
      const frame = updatedFrames.find((f) => f.phase === phase)!
      if (!frame.dataUrl || !detectPose) {
        frame.pose = null
        continue
      }
      frame.processing = true
      setFrames([...updatedFrames])
      try {
        frame.pose = await detectPose(frame.dataUrl)
      } catch {
        frame.pose = { landmarks: [], overlayDataUrl: frame.dataUrl, detected: false }
      }
      frame.processing = false
      setFrames([...updatedFrames])
    }

    const result = analyzeSwing(updatedFrames)
    setAnalysis(result)
    setHasRun(true)
    setIsAnalyzing(false)
    toast.success('Swing analysis complete!')
  }, [videoUrl, frames])

  return (
    <div className="space-y-6 pb-16">
      {/* ── Hero header ── */}
      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[var(--panel)] shadow-xl">
        {/* accent stripe */}
        <div className="h-1 w-full bg-gradient-to-r from-[var(--accent)]/60 via-[var(--accent)] to-[var(--accent)]/40" />

        <div className="p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">
                AI-Powered · Browser-Based · Free
              </p>
              <h1 className="text-2xl font-bold text-white">Golf Swing Analyzer</h1>
              <p className="max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
                Upload any swing video to get pose-detected frame analysis, 8 biomechanical
                metrics, and personalised questions ready for your next lesson.
              </p>
            </div>

            {videoUrl && frames.length > 0 && (
              <div className="flex shrink-0 gap-3">
                {hasRun && (
                  <button
                    onClick={handleClear}
                    className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-4 py-2.5 text-sm text-[var(--muted-foreground)] transition hover:border-white/20 hover:text-white"
                  >
                    <RotateCcw className="h-4 w-4" />
                    New video
                  </button>
                )}
                <button
                  onClick={runAnalysis}
                  disabled={isAnalyzing}
                  className="flex items-center gap-2.5 rounded-2xl bg-[var(--accent)] px-6 py-2.5 text-sm font-bold text-black shadow-lg shadow-[var(--accent)]/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Analyzing…
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 fill-black" />
                      {hasRun ? 'Re-analyze' : 'Analyze Swing'}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Step progress bar */}
          <div className="mt-5 border-t border-white/6 pt-4">
            <StepBar current={currentStep} />
          </div>
        </div>
      </div>

      {/* ── "How it works" strip — shown only before first run ── */}
      {!videoUrl && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { n: 1, title: 'Upload video', body: 'Film from the front or down-the-line. Full body visible.' },
            { n: 2, title: 'Set frame times', body: 'Drag the sliders to pin each swing phase to the right moment.' },
            { n: 3, title: 'Analyze', body: 'MediaPipe detects 33 body landmarks and overlays a skeleton.' },
            { n: 4, title: 'Read notes', body: '8 biomechanical metrics graded good / watch / fix.' },
            { n: 5, title: 'Ask your coach', body: 'AI generates the exact questions to bring to your next lesson.' },
          ].map(({ n, title, body }) => (
            <div
              key={n}
              className="flex gap-3 rounded-2xl border border-white/6 bg-[var(--panel)] p-4"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/20 text-xs font-bold text-[var(--accent)]">
                {n}
              </span>
              <div>
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">{body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          <VideoUploadCard
            videoFile={videoFile}
            videoUrl={videoUrl}
            onVideoSelected={handleVideoSelected}
            onClear={handleClear}
          />
          {frames.length > 0 && (
            <SwingTimelineCard
              frames={frames}
              activePhase={activePhase}
              onSelectPhase={setActivePhase}
              videoDuration={videoDuration}
              onTimestampChange={handleTimestampChange}
              hasRun={hasRun}
            />
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <PoseOverlayCard
            frames={frames}
            activePhase={activePhase}
            onSelectPhase={setActivePhase}
          />
          <SwingNotesCard analysis={analysis} isAnalyzing={isAnalyzing} />
          <LessonQuestionsCard analysis={analysis} isAnalyzing={isAnalyzing} />
        </div>
      </div>
    </div>
  )
}
