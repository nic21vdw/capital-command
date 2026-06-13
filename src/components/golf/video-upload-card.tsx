'use client'

import { useRef, useCallback, useState } from 'react'
import { UploadCloud, Video, X, ChevronDown, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  videoUrl: string | null
  videoFile: File | null
  onVideoSelected: (file: File, url: string) => void
  onClear: () => void
}

const TIPS = [
  'Film from face-on or down-the-line, not angles in between',
  'Ensure your full body is visible from head to feet',
  'Good lighting with a plain background gives the best pose detection',
  'Landscape orientation works best, at least 720p resolution',
  'A slow-motion video will give more accurate frame selection',
]

export function VideoUploadCard({ videoUrl, videoFile, onVideoSelected, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [tipsOpen, setTipsOpen] = useState(false)

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('video/')) return
      const url = URL.createObjectURL(file)
      onVideoSelected(file, url)
    },
    [onVideoSelected],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[var(--panel)] shadow-xl">
      {/* Card header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/20">
            <Video className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                Step 1
              </span>
            </div>
            <h2 className="text-sm font-semibold text-white">Upload Your Swing Video</h2>
          </div>
        </div>
        {videoFile && (
          <button
            onClick={onClear}
            title="Remove video"
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/8 text-[var(--muted-foreground)] transition hover:bg-red-500/20 hover:text-red-400"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-6 pb-6 space-y-4">
        {videoUrl ? (
          <>
            <video
              src={videoUrl}
              controls
              className="w-full rounded-2xl bg-black ring-1 ring-white/8"
              style={{ maxHeight: 340 }}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-[var(--muted-foreground)]">
                <span className="text-white/60">{videoFile?.name}</span>
                {' '}&middot;{' '}
                {videoFile ? (videoFile.size / 1_000_000).toFixed(1) : 0} MB
              </p>
              <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Ready
              </span>
            </div>
            <div className="rounded-2xl border border-[var(--accent)]/15 bg-[var(--accent)]/5 px-4 py-3">
              <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--accent)]">Next:</span>{' '}
                Scroll down to set the timestamp for each swing phase in the timeline, then click{' '}
                <strong className="text-white">Analyze Swing</strong> in the header.
              </p>
            </div>
          </>
        ) : (
          <>
            <div
              onDrop={onDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => inputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed border-white/12 bg-white/3 py-14 transition hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/4"
            >
              <div className="relative">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent)]/12 ring-1 ring-[var(--accent)]/20">
                  <UploadCloud className="h-7 w-7 text-[var(--accent)]" />
                </div>
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-black">
                  +
                </span>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">Drop your swing video here</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  or click to browse &middot; MP4, MOV, WebM, AVI
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
              />
            </div>

            {/* Filming tips accordion */}
            <button
              onClick={() => setTipsOpen((o) => !o)}
              className="flex w-full items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-left transition hover:border-white/14 hover:bg-white/6"
            >
              <div className="flex items-center gap-2">
                <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-medium text-white">Tips for the best results</span>
              </div>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-[var(--muted-foreground)] transition-transform',
                  tipsOpen && 'rotate-180',
                )}
              />
            </button>

            {tipsOpen && (
              <ul className="space-y-2 px-1">
                {TIPS.map((tip, i) => (
                  <li key={i} className="flex gap-2.5 text-xs text-[var(--muted-foreground)]">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]/60" />
                    {tip}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
