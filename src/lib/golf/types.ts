export type SwingPhase = 'address' | 'takeaway' | 'top' | 'downswing' | 'impact' | 'follow_through'

export const SWING_PHASES: { phase: SwingPhase; label: string; description: string; defaultPct: number }[] = [
  { phase: 'address', label: 'Address', description: 'Setup position', defaultPct: 0.05 },
  { phase: 'takeaway', label: 'Takeaway', description: 'Club moves back', defaultPct: 0.18 },
  { phase: 'top', label: 'Top of Backswing', description: 'Maximum coil', defaultPct: 0.35 },
  { phase: 'downswing', label: 'Downswing', description: 'Transition to impact', defaultPct: 0.52 },
  { phase: 'impact', label: 'Impact', description: 'Ball contact', defaultPct: 0.62 },
  { phase: 'follow_through', label: 'Follow Through', description: 'Post-impact', defaultPct: 0.82 },
]

export interface PoseKeypoint {
  name: string
  x: number
  y: number
  z: number
  visibility: number
}

export interface PoseResult {
  landmarks: PoseKeypoint[]
  overlayDataUrl: string
  detected: boolean
}

export interface FrameWithPose {
  phase: SwingPhase
  timestamp: number
  dataUrl: string
  pose: PoseResult | null
  processing: boolean
  error: string | null
}

export type MetricAssessment = 'good' | 'warning' | 'needs_work' | 'unknown'

export interface SwingMetric {
  name: string
  assessment: MetricAssessment
  description: string
  detail?: string
}

export interface SwingAnalysis {
  metrics: SwingMetric[]
  faults: string[]
  tips: string[]
  lessonQuestions: string[]
  hasPoseData: boolean
}
