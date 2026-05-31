'use client'

import { useState, useCallback } from 'react'
import { Play, RotateCcw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import type { FrameWithPose, SwingPhase, SwingAnalysis } from '@/lib/golf/types'
import { SWING_PHASES } from '@/lib/golf/types'
import { buildInitialFrames, extractFrameAtTime } from '@/lib/golf/frame-extractor'
import { analyzeSwing } from '@/lib/golf/swing-analyzer'

import { VideoUploadCard } from './video-upload-card'
import { SwingTimelineCard } from './swing-timeline-card'
import { PoseOverlayCard } from './pose-overlay-card'
import { SwingNotesCard } from './swing-notes-card'
import { LessonQuestionsCard } from './lesson-questions-card'

export function GolfSwingPage() {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [frames, setFrames] = useState<FrameWithPose[]>([])
  const [activePhase, setActivePhase] = useState<SwingPhase>('address')
  const [analysis, setAnalysis] = useState<SwingAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [hasRun, setHasRun] = useState(false)

  const handleVideoSelected = useCallback((file: File, url: string) => {
    setVideoFile(file)
    setVideoUrl(url)
    setAnalysis(null)
    setHasRun(false)
    setFrames([])
    setVideoDuration(0)

    // We read the duration once the element is created
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

    // Create a hidden video element to drive frame extraction
    const vid = document.createElement('video')
    vid.src = videoUrl
    vid.crossOrigin = 'anonymous'
    vid.preload = 'auto'
    await new Promise<void>((res) => {
      vid.onloadeddata = () => res()
      vid.load()
    })

    // Extract all frames
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

    // Run pose detection (dynamically imported to keep initial bundle small)
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
      {/* Header */}
      <div className="rounded-[28px] border border-white/10 bg-[var(--panel)] p-6 shadow-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">
              Golf Swing Analysis
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-white">Swing Analyzer</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Upload a swing video, extract key frames, detect body positions, and get personalised
              coaching notes ready for your next lesson.
            </p>
          </div>

          {videoUrl && frames.length > 0 && (
            <div className="flex gap-3">
              {hasRun && (
                <button
                  onClick={handleClear}
                  className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-4 py-2.5 text-sm text-[var(--muted-foreground)] transition hover:border-white/20 hover:text-white"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
              )}
              <button
                onClick={runAnalysis}
                disabled={isAnalyzing}
                className="flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-black shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    {hasRun ? 'Re-analyze' : 'Analyze Swing'}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main grid */}
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
