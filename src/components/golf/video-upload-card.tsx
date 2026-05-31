'use client'

import { useRef, useCallback } from 'react'
import { UploadCloud, Video, X } from 'lucide-react'

interface Props {
  videoUrl: string | null
  videoFile: File | null
  onVideoSelected: (file: File, url: string) => void
  onClear: () => void
}

export function VideoUploadCard({ videoUrl, videoFile, onVideoSelected, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

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
    <div className="rounded-[28px] border border-white/10 bg-[var(--panel)] p-6 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15">
            <Video className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">Step 1</p>
            <h2 className="text-sm font-semibold text-white">Video Upload</h2>
          </div>
        </div>
        {videoFile && (
          <button
            onClick={onClear}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/8 text-[var(--muted-foreground)] transition hover:bg-white/14 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {videoUrl ? (
        <div className="space-y-3">
          <video
            src={videoUrl}
            controls
            className="w-full rounded-2xl bg-black"
            style={{ maxHeight: 340 }}
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            {videoFile?.name} &middot; {videoFile ? (videoFile.size / 1_000_000).toFixed(1) : 0} MB
          </p>
        </div>
      ) : (
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-white/14 bg-white/4 py-12 transition hover:border-[var(--accent)]/50 hover:bg-white/8"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/12 ring-1 ring-[var(--accent)]/20">
            <UploadCloud className="h-6 w-6 text-[var(--accent)]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-white">Drop your swing video here</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              or click to browse &middot; MP4, MOV, WebM
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
      )}
    </div>
  )
}
