// ─── Swing Phases ────────────────────────────────────────────────────────────

export type SwingPhase =
  | 'address'
  | 'takeaway'
  | 'shaft_parallel_back'
  | 'lead_arm_parallel'
  | 'top'
  | 'transition'
  | 'downswing'
  | 'shaft_parallel_down'
  | 'impact'
  | 'early_follow_through'
  | 'finish'

export const SWING_PHASES: {
  phase: SwingPhase
  label: string
  description: string
  defaultPct: number
}[] = [
  { phase: 'address', label: 'Address', description: 'Setup position', defaultPct: 0.05 },
  { phase: 'takeaway', label: 'Takeaway', description: 'First move back', defaultPct: 0.12 },
  { phase: 'shaft_parallel_back', label: 'Shaft Parallel ↑', description: 'Club parallel to ground', defaultPct: 0.22 },
  { phase: 'lead_arm_parallel', label: 'Lead Arm Parallel', description: 'Left arm horizontal', defaultPct: 0.30 },
  { phase: 'top', label: 'Top of Backswing', description: 'Maximum coil', defaultPct: 0.38 },
  { phase: 'transition', label: 'Transition', description: 'Start of downswing', defaultPct: 0.46 },
  { phase: 'downswing', label: 'Downswing', description: 'Mid-downswing slot', defaultPct: 0.54 },
  { phase: 'shaft_parallel_down', label: 'Shaft Parallel ↓', description: 'Club parallel on way down', defaultPct: 0.60 },
  { phase: 'impact', label: 'Impact', description: 'Ball contact', defaultPct: 0.65 },
  { phase: 'early_follow_through', label: 'Early Follow Through', description: 'Post-impact release', defaultPct: 0.74 },
  { phase: 'finish', label: 'Finish', description: 'Full follow through', defaultPct: 0.86 },
]

// ─── Pose ─────────────────────────────────────────────────────────────────────

export interface PoseKeypoint {
  name: string
  x: number
  y: number
  z: number
  visibility: number
}

export interface PoseResult {
  landmarks: PoseKeypoint[]
  /** Frame with skeleton overlay only (no fault annotations) */
  overlayDataUrl: string
  detected: boolean
}

export interface FrameWithPose {
  phase: SwingPhase
  timestamp: number
  dataUrl: string
  pose: PoseResult | null
  /** Frame with fault-specific annotations drawn on top */
  annotatedUrl: string | null
  processing: boolean
  error: string | null
}

// ─── Issues ──────────────────────────────────────────────────────────────────

export type IssueId =
  | 'early_release'
  | 'flying_elbow'
  | 'loss_of_posture'
  | 'head_sway'
  | 'limited_hip_rotation'
  | 'limited_shoulder_turn'
  | 'reverse_pivot'
  | 'weight_stall'

export interface Drill {
  name: string
  cue: string
}

export interface SwingIssue {
  id: IssueId
  name: string
  /** 1 = highest priority, 3 = lowest of the top 3 */
  priority: 1 | 2 | 3
  /** 0–100 */
  severity: number
  primaryPhase: SwingPhase
  whatAISees: string
  potentialResult: string
  drills: Drill[]
  youtubeSearch: string
  lessonQuestion: string
  /** Phase overlay URL with fault annotation drawn on it */
  annotatedFrameUrl: string | null
}

// ─── Pro comparison ───────────────────────────────────────────────────────────

export interface ProTemplate {
  id: string
  name: string
  style: string
  referenceMetrics: {
    spineAngleAtAddress: number
    shoulderTurnAtTop: number
    hipRotationAtImpact: number
    spineAngleConsistency: number   // max allowed deviation
    headMovementThreshold: number   // max normalised lateral movement
    trailElbowAngleAtTop: number
  }
  traitDescription: string
}

// ─── Final analysis object ───────────────────────────────────────────────────

export interface SwingAnalysisV2 {
  issues: SwingIssue[]          // top 3 ranked
  allIssueIds: IssueId[]        // all detected (for coach plan)
  hasPoseData: boolean
  lessonQuestions: string[]
  coachPlanItems: CoachPlanItem[]
}

export interface CoachPlanItem {
  issueId: IssueId
  name: string
  problem: string
  evidence: string
  drills: Drill[]
  youtubeSearch: string
  expectedImprovement: string
  primaryFrameUrl: string | null
}

// ─── Legacy metric types (kept for swing-analyzer.ts compatibility) ──────────

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
