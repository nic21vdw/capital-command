import { SWING_PHASES, type FrameWithPose, type SwingPhase } from './types'

export async function extractFrameAtTime(
  video: HTMLVideoElement,
  timestamp: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 360
    const ctx = canvas.getContext('2d')
    if (!ctx) return reject(new Error('Canvas context unavailable'))

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }

    video.addEventListener('seeked', onSeeked)
    video.currentTime = Math.max(0, Math.min(timestamp, video.duration - 0.01))
  })
}

export function buildInitialFrames(duration: number): FrameWithPose[] {
  return SWING_PHASES.map(({ phase, defaultPct }) => ({
    phase,
    timestamp: duration * defaultPct,
    dataUrl: '',
    pose: null,
    annotatedUrl: null,
    processing: false,
    error: null,
  }))
}

export async function extractAllFrames(
  video: HTMLVideoElement,
  timestamps: Record<SwingPhase, number>,
  onProgress: (phase: SwingPhase, dataUrl: string) => void,
): Promise<void> {
  for (const { phase } of SWING_PHASES) {
    const dataUrl = await extractFrameAtTime(video, timestamps[phase])
    onProgress(phase, dataUrl)
  }
}
