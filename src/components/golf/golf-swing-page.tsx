'use client'

import { useState, useCallback } from 'react'
import { Play, RotateCcw, Loader2, CheckCircle2, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

import type { FrameWithPose, SwingPhase, SwingAnalysisV2, IssueId } from '@/lib/golf/types'
import { SWING_PHASES } from '@/lib/golf/types'
import { buildInitialFrames, extractFrameAtTime } from '@/lib/golf/frame-extractor'
import { detectIssues, buildAnalysisV2, issuePrimaryPhase } from '@/lib/golf/issue-detector'
import { createAnnotatedFrame, issueIdToAnnotationType } from '@/lib/golf/annotation-engine'

import { VideoUploadCard } from './video-upload-card'
import { SwingTimelineCard } from './swing-timeline-card'
import { PriorityIssuesCard } from './priority-issues-card'
import { ProComparisonCard } from './pro-comparison-card'
import { CoachModeCard } from './coach-mode-card'
import { LessonQuestionsCard } from './lesson-questions-card'

// ─── Progress stepper ─────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'Upload' },
  { n: 2, label: 'Set Frames' },
  { n: 3, label: 'Analyze' },
  { n: 4, label: 'Findings' },
  { n: 5, label: 'Pro Compare' },
  { n: 6, label: 'Coach Plan' },
  { n: 7, label: 'Questions' },
]

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
      {STEPS.map(({ n, label }, i) => {
        const done = current > n
        const active = current === n
        return (
          <div key={n} className="flex items-center gap-1">
            <div className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-xs font-medium transition',
              done && 'text-emerald-400',
              active && 'bg-[var(--accent)]/20 text-[var(--accent)]',
              !done && !active && 'text-[var(--muted-foreground)]',
            )}>
              {done ? (
                <CheckCircle2 className="h-3 w-3 shrink-0" />
              ) : (
                <span className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold',
                  active ? 'bg-[var(--accent)] text-black' : 'bg-white/10 text-white/40',
                )}>
                  {n}
                </span>
              )}
              {label}
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight className="h-3 w-3 shrink-0 text-white/15" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Analysis stage label ─────────────────────────────────────────────────────

const STAGES = [
  'Extracting frames…',
  'Loading pose model…',
  'Detecting body landmarks…',
  'Identifying swing faults…',
  'Drawing annotations…',
  'Building coach plan…',
]

// ─── Main page ────────────────────────────────────────────────────────────────

export function GolfSwingPage() {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [frames, setFrames] = useState<FrameWithPose[]>([])
  const [activePhase, setActivePhase] = useState<SwingPhase>('address')
  const [analysis, setAnalysis] = useState<SwingAnalysisV2 | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [stageLabel, setStageLabel] = useState('')
  const [hasRun, setHasRun] = useState(false)

  const currentStep = analysis ? 4 : isAnalyzing ? 3 : videoUrl ? 2 : 1

  // ─── Handlers ──────────────────────────────────────────────────────────────

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
      prev.map((f) =>
        f.phase === phase ? { ...f, timestamp: seconds, dataUrl: '', pose: null, annotatedUrl: null } : f,
      ),
    )
  }, [])

  // ─── Analysis pipeline ──────────────────────────────────────────────────────

  const runAnalysis = useCallback(async () => {
    if (!videoUrl || frames.length === 0) return
    setIsAnalyzing(true)
    setAnalysis(null)

    // 1. Load video
    const vid = document.createElement('video')
    vid.src = videoUrl
    vid.crossOrigin = 'anonymous'
    vid.preload = 'auto'
    await new Promise<void>((res) => { vid.onloadeddata = () => res(); vid.load() })

    // 2. Extract all 11 frames
    setStageLabel(STAGES[0])
    const updatedFrames: FrameWithPose[] = frames.map((f) => ({ ...f, processing: true, annotatedUrl: null }))
    setFrames([...updatedFrames])

    for (const { phase } of SWING_PHASES) {
      const frame = updatedFrames.find((f) => f.phase === phase)!
      try {
        frame.dataUrl = await extractFrameAtTime(vid, frame.timestamp)
      } catch {
        frame.dataUrl = ''
        frame.error = 'extraction failed'
      }
      frame.processing = false
      setFrames([...updatedFrames])
    }

    // 3. Load pose detector
    setStageLabel(STAGES[1])
    toast.info('Loading pose model…', { duration: 3000 })
    let detectPose: ((url: string) => Promise<import('@/lib/golf/types').PoseResult>) | null = null
    try {
      const mod = await import('@/lib/golf/pose-detector')
      detectPose = mod.detectPoseInFrame
    } catch {
      toast.warning('Pose detection failed to load. Showing frames without analysis.')
    }

    // 4. Run pose detection on all frames
    setStageLabel(STAGES[2])
    for (const { phase } of SWING_PHASES) {
      const frame = updatedFrames.find((f) => f.phase === phase)!
      if (!frame.dataUrl || !detectPose) { frame.pose = null; continue }
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

    // 5. Detect issues
    setStageLabel(STAGES[3])
    const { rankedIssues, hasPoseData } = detectIssues(updatedFrames)
    const top3 = rankedIssues.slice(0, 3)

    // 6. Create annotated frames for each detected issue
    setStageLabel(STAGES[4])
    const annotatedUrls: Partial<Record<IssueId, string>> = {}
    const byPhase = new Map(updatedFrames.map((f) => [f.phase, f]))

    for (const raw of top3) {
      const issueId = raw.id
      const annotType = issueIdToAnnotationType(issueId)
      if (!annotType) continue

      const primaryPhase = issuePrimaryPhase(issueId)
      const primaryFrame = byPhase.get(primaryPhase)
      if (!primaryFrame?.pose?.overlayDataUrl || !primaryFrame.pose.landmarks) continue

      const addressFrame = byPhase.get('address')
      const addressLms = addressFrame?.pose?.landmarks ?? []

      try {
        const specs: import('@/lib/golf/annotation-engine').AnnotationSpec[] = []

        if (annotType === 'early_release' || annotType === 'flying_elbow' || annotType === 'limited_shoulder_turn') {
          specs.push({ type: annotType, landmarks: primaryFrame.pose.landmarks })
        } else if (annotType === 'head_sway' || annotType === 'loss_of_posture' || annotType === 'hip_rotation') {
          if (addressLms.length > 0) {
            specs.push({ type: annotType, landmarks: primaryFrame.pose.landmarks, addressLandmarks: addressLms })
          }
        }

        if (specs.length > 0) {
          const annotUrl = await createAnnotatedFrame(primaryFrame.pose.overlayDataUrl, specs)
          annotatedUrls[issueId] = annotUrl

          // Also attach to the frame itself
          primaryFrame.annotatedUrl = annotUrl
          setFrames([...updatedFrames])
        }
      } catch {
        // Annotation failed — no-op, issue still shows without visual
      }
    }

    // 7. Build final analysis
    setStageLabel(STAGES[5])
    const result = buildAnalysisV2(updatedFrames, annotatedUrls)
    setAnalysis(result)
    setHasRun(true)
    setIsAnalyzing(false)
    setStageLabel('')

    if (!hasPoseData) {
      toast.warning('Pose not detected. Try better lighting and ensure full body is visible.')
    } else {
      toast.success(`Analysis complete — ${result.issues.length} issue${result.issues.length !== 1 ? 's' : ''} found`)
    }
  }, [videoUrl, frames])

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-16">
      {/* ── Hero header ── */}
      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[var(--panel)] shadow-xl">
        <div className="h-1 w-full bg-gradient-to-r from-[var(--accent)]/40 via-[var(--accent)] to-[var(--accent)]/40" />
        <div className="p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">
                Visual AI Coach · 11-Phase Analysis · Browser-Based
              </p>
              <h1 className="text-2xl font-bold text-white">Golf Swing Analyzer V2</h1>
              <p className="max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
                Upload a swing video and get annotated fault frames, top-3 priority issues, pro comparison,
                and a full coach-ready lesson plan — all in your browser.
              </p>
            </div>

            {videoUrl && frames.length > 0 && (
              <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                {isAnalyzing && stageLabel && (
                  <p className="text-xs text-[var(--muted-foreground)]">{stageLabel}</p>
                )}
                <div className="flex gap-3">
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
                      <><Loader2 className="h-4 w-4 animate-spin" />Analyzing…</>
                    ) : (
                      <><Play className="h-4 w-4 fill-black" />{hasRun ? 'Re-analyze' : 'Analyze Swing'}</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-white/6 pt-4">
            <StepBar current={currentStep} />
          </div>
        </div>
      </div>

      {/* ── How it works — only before first upload ── */}
      {!videoUrl && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: 1, icon: '📹', title: 'Upload video', body: 'Any MP4/MOV of your golf swing. Full body visible.' },
            { n: 2, icon: '🎯', title: 'Set 11 positions', body: 'Drag sliders to pin each swing phase accurately.' },
            { n: 3, icon: '🧠', title: 'AI annotates faults', body: 'Visual arrows, circles, and lines drawn on your frames.' },
            { n: 4, icon: '📋', title: 'Get your lesson plan', body: 'Top 3 issues, drills, pro comparison, and coach questions.' },
          ].map(({ n, icon, title, body }) => (
            <div key={n} className="flex gap-3 rounded-2xl border border-white/6 bg-[var(--panel)] p-4">
              <span className="text-2xl">{icon}</span>
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
        {/* Left column — Upload + Timeline */}
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

        {/* Right column — AI results */}
        <div className="space-y-6">
          <PriorityIssuesCard
            issues={analysis?.issues ?? []}
            isAnalyzing={isAnalyzing}
            hasPoseData={analysis?.hasPoseData ?? false}
          />
          <ProComparisonCard frames={frames} analysis={analysis} />
          <CoachModeCard analysis={analysis} />
          <LessonQuestionsCard analysis={analysis} isAnalyzing={isAnalyzing} />
        </div>
      </div>
    </div>
  )
}
