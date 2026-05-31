/**
 * Detects swing faults from pose landmark data and ranks the top 3 by impact.
 * Returns fully-populated SwingIssue objects ready for display.
 */

import type { FrameWithPose, SwingIssue, IssueId, Drill, CoachPlanItem, SwingAnalysisV2 } from './types'
import type { PoseKeypoint } from './types'

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function kp(lms: PoseKeypoint[], name: string): PoseKeypoint | null {
  return lms.find((l) => l.name === name) ?? null
}

function vis(p: PoseKeypoint | null, t = 0.35): p is PoseKeypoint {
  return p !== null && (p.visibility ?? 0) >= t
}

function midpoint(a: PoseKeypoint, b: PoseKeypoint) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function spineAngle(lms: PoseKeypoint[]): number | null {
  const ls = kp(lms, 'left_shoulder')
  const rs = kp(lms, 'right_shoulder')
  const lh = kp(lms, 'left_hip')
  const rh = kp(lms, 'right_hip')
  if (!vis(ls) || !vis(rs) || !vis(lh) || !vis(rh)) return null
  const sh = midpoint(ls, rs)
  const hp = midpoint(lh, rh)
  return Math.abs(Math.atan2(Math.abs(sh.x - hp.x), Math.abs(sh.y - hp.y)) * (180 / Math.PI))
}

function hipLineAngle(lms: PoseKeypoint[]): number | null {
  const lh = kp(lms, 'left_hip')
  const rh = kp(lms, 'right_hip')
  if (!vis(lh) || !vis(rh)) return null
  return Math.atan2(rh.y - lh.y, rh.x - lh.x) * (180 / Math.PI)
}

function shoulderLineAngle(lms: PoseKeypoint[]): number | null {
  const ls = kp(lms, 'left_shoulder')
  const rs = kp(lms, 'right_shoulder')
  if (!vis(ls) || !vis(rs)) return null
  return Math.abs(Math.atan2(rs.y - ls.y, rs.x - ls.x) * (180 / Math.PI))
}

// ─── Individual fault detectors ───────────────────────────────────────────────

type DetectionResult = { severity: number; detected: boolean }

function detectFlyingElbow(topLms: PoseKeypoint[] | null): DetectionResult {
  if (!topLms) return { severity: 0, detected: false }
  const e = kp(topLms, 'right_elbow')
  const s = kp(topLms, 'right_shoulder')
  if (!vis(e) || !vis(s)) return { severity: 0, detected: false }
  // In image coords: lower y = higher on screen. Flying if elbow y < shoulder y
  if (e.y < s.y) {
    const diff = (s.y - e.y)  // normalised difference
    const severity = Math.min(100, diff * 500)
    return { severity, detected: true }
  }
  return { severity: 0, detected: false }
}

function detectEarlyRelease(
  downswingLms: PoseKeypoint[] | null,
  impactLms: PoseKeypoint[] | null,
): DetectionResult {
  // Proxy: if right wrist is far BELOW right elbow at downswing/impact, casting has happened
  const lms = downswingLms ?? impactLms
  if (!lms) return { severity: 0, detected: false }
  const w = kp(lms, 'right_wrist')
  const e = kp(lms, 'right_elbow')
  const s = kp(lms, 'right_shoulder')
  if (!vis(w) || !vis(e) || !vis(s)) return { severity: 0, detected: false }
  // Wrist should not extend far past the elbow line early in downswing
  const armLength = Math.abs(s.y - e.y)
  const excess = w.y - (e.y + armLength * 0.6)
  if (excess > 0) {
    const severity = Math.min(100, excess * 600)
    return { severity, detected: severity > 20 }
  }
  return { severity: 0, detected: false }
}

function detectLossOfPosture(
  addressLms: PoseKeypoint[] | null,
  impactLms: PoseKeypoint[] | null,
): DetectionResult {
  const sa = addressLms ? spineAngle(addressLms) : null
  const si = impactLms ? spineAngle(impactLms) : null
  if (sa === null || si === null) return { severity: 0, detected: false }
  const diff = Math.abs(si - sa)
  return { severity: Math.min(100, diff * 4), detected: diff > 8 }
}

function detectHeadSway(
  addressLms: PoseKeypoint[] | null,
  impactLms: PoseKeypoint[] | null,
): DetectionResult {
  const an = addressLms ? kp(addressLms, 'nose') : null
  const cn = impactLms ? kp(impactLms, 'nose') : null
  if (!vis(an) || !vis(cn)) return { severity: 0, detected: false }
  const dx = Math.abs(cn.x - an.x)
  const dy = Math.abs(cn.y - an.y)
  const dist = Math.sqrt(dx * dx + dy * dy)
  return { severity: Math.min(100, dist * 500), detected: dist > 0.06 }
}

function detectLimitedHipRotation(
  addressLms: PoseKeypoint[] | null,
  impactLms: PoseKeypoint[] | null,
): DetectionResult {
  const aa = addressLms ? hipLineAngle(addressLms) : null
  const ia = impactLms ? hipLineAngle(impactLms) : null
  if (aa === null || ia === null) return { severity: 0, detected: false }
  const rotation = Math.abs(ia - aa)
  const shortfall = Math.max(0, 28 - rotation)
  return { severity: Math.min(100, shortfall * 3), detected: rotation < 22 }
}

function detectLimitedShoulderTurn(topLms: PoseKeypoint[] | null): DetectionResult {
  if (!topLms) return { severity: 0, detected: false }
  const angle = shoulderLineAngle(topLms)
  if (angle === null) return { severity: 0, detected: false }
  const shortfall = Math.max(0, 38 - angle)
  return { severity: Math.min(100, shortfall * 3), detected: angle < 28 }
}

function detectReversePivot(
  addressLms: PoseKeypoint[] | null,
  topLms: PoseKeypoint[] | null,
): DetectionResult {
  const ah = addressLms ? kp(addressLms, 'left_hip') : null
  const th = topLms ? kp(topLms, 'left_hip') : null
  if (!vis(ah) || !vis(th)) return { severity: 0, detected: false }
  // Lead hip moving toward target (decreasing x) at top is reverse pivot
  const shift = ah.x - th.x   // positive = hip moved away from target
  if (shift < -0.03) {
    return { severity: Math.min(100, Math.abs(shift) * 500), detected: true }
  }
  return { severity: 0, detected: false }
}

function detectWeightStall(
  addressLms: PoseKeypoint[] | null,
  impactLms: PoseKeypoint[] | null,
): DetectionResult {
  const ah = addressLms ? kp(addressLms, 'left_hip') : null
  const ih = impactLms ? kp(impactLms, 'left_hip') : null
  if (!vis(ah) || !vis(ih)) return { severity: 0, detected: false }
  const shift = ah.x - ih.x   // positive = hip moved toward target
  if (shift < 0.01) {
    return { severity: Math.min(100, (0.05 - shift) * 600), detected: true }
  }
  return { severity: 0, detected: false }
}

// ─── Issue library ────────────────────────────────────────────────────────────

const ISSUE_LIBRARY: Record<
  IssueId,
  {
    name: string
    whatAISees: string
    potentialResult: string
    drills: Drill[]
    youtubeSearch: string
    lessonQuestion: string
    expectedImprovement: string
  }
> = {
  early_release: {
    name: 'Early Release',
    whatAISees: 'Club angle is being lost before impact — wrists are unhinging too early in the downswing.',
    potentialResult: 'Loss of clubhead speed, thin/fat contact, weak ball flight, and inconsistent compression.',
    drills: [
      { name: 'Pump Drill', cue: 'Start the downswing by pumping the club down three times before releasing.' },
      { name: 'Impact Bag', cue: 'Hit into a bag and hold your wrist angle all the way to the moment of contact.' },
    ],
    youtubeSearch: 'golf early release fix wrist lag drill',
    lessonQuestion: 'I notice my wrists release early — is this contributing to my ball flight issues, and should I work on wrist lag or sequence first?',
    expectedImprovement: 'Improved compression, 5–15 yards of additional carry distance.',
  },
  flying_elbow: {
    name: 'Flying Trail Elbow',
    whatAISees: 'Trail elbow is rising above the shoulder plane at the top of backswing.',
    potentialResult: 'Steep downswing, over-the-top swing path, pull or slice ball flight.',
    drills: [
      { name: 'Towel Drill', cue: 'Tuck a towel under your trail arm. Keep it in place to the top of your backswing.' },
      { name: 'Wall Drill', cue: 'Practice backswing with a wall on your trail side to prevent the elbow from flying.' },
    ],
    youtubeSearch: 'golf flying elbow fix backswing trail arm drill',
    lessonQuestion: 'Does my flying trail elbow cause an over-the-top move, and what checkpoint should I use to know it\'s fixed?',
    expectedImprovement: 'Shallower attack angle, straighter or right-to-left ball flight.',
  },
  loss_of_posture: {
    name: 'Loss of Posture',
    whatAISees: 'Spine angle changes significantly from address to impact — golfer is standing up or slumping through the shot.',
    potentialResult: 'Thin strikes, fat strikes, inconsistent contact, difficulty compressing the ball.',
    drills: [
      { name: 'Wall Posture Drill', cue: 'Stand with your tail touching a wall at address; maintain contact through a mock impact.' },
      { name: 'Chair Drill', cue: 'Lean your trail glute against a chair back — keep contact through the swing to stop standing up.' },
    ],
    youtubeSearch: 'golf early extension loss of posture fix drill',
    lessonQuestion: 'Am I losing spine angle because of early extension or because I\'m collapsing into the shot, and what is causing it?',
    expectedImprovement: 'More consistent strike quality and centre-face contact.',
  },
  head_sway: {
    name: 'Head Sway',
    whatAISees: 'Head is moving laterally through the swing rather than staying centred over the ball.',
    potentialResult: 'Inconsistent contact, fat shots, timing issues, loss of power through impact.',
    drills: [
      { name: 'Foot Flare Drill', cue: 'Flare both feet 30 degrees to allow hip turn without lateral sway.' },
      { name: 'Alignment Stick Drill', cue: 'Stick an alignment stick in the ground beside your head as a reference at address.' },
    ],
    youtubeSearch: 'golf head sway lateral movement fix drill',
    lessonQuestion: 'Is my head sway a flexibility issue, a balance issue, or a swing mechanics issue — and what should I address first?',
    expectedImprovement: 'More consistent strike, improved compression and centre contact.',
  },
  limited_hip_rotation: {
    name: 'Limited Hip Rotation',
    whatAISees: 'Hips are not clearing fully through impact — hip rotation is below the expected threshold.',
    potentialResult: 'Block or push, flip at impact, loss of power, back pain from arms overcompensating.',
    drills: [
      { name: 'Step-Through Drill', cue: 'After impact, step your trail foot forward to force full hip rotation.' },
      { name: 'Hip Bumps', cue: 'Without a club, practice pushing lead hip toward the target at start of downswing.' },
    ],
    youtubeSearch: 'golf hip rotation through impact drill fix',
    lessonQuestion: 'Is my limited hip rotation causing my push/block, and is it a mobility issue or a sequencing issue?',
    expectedImprovement: 'More distance and improved face-to-path relationship.',
  },
  limited_shoulder_turn: {
    name: 'Limited Shoulder Turn',
    whatAISees: 'Shoulders are not fully rotating at the top of backswing — coil appears restricted.',
    potentialResult: 'Loss of power, compensatory arm lifting, arms-only swing with no body involvement.',
    drills: [
      { name: 'Cross-Arm Rotation', cue: 'Cross arms on chest and turn until trail shoulder is behind the ball.' },
      { name: 'Sit and Turn', cue: 'Sit on the edge of a chair and practice full shoulder rotation without swaying.' },
    ],
    youtubeSearch: 'golf shoulder turn backswing increase rotation drill',
    lessonQuestion: 'Is my limited shoulder turn a flexibility issue or am I mis-sequencing the takeaway, and how do I know the difference?',
    expectedImprovement: 'More width and coil, leading to increased clubhead speed.',
  },
  reverse_pivot: {
    name: 'Reverse Pivot',
    whatAISees: 'Lead hip appears to be drifting toward the target at the top of backswing instead of loading into the trail side.',
    potentialResult: 'Fat shots, high weak shots, loss of power, "coming over the top" tendency.',
    drills: [
      { name: 'Right Pocket Back', cue: 'Feel like you are turning your trail pocket away from the target in the backswing.' },
      { name: 'Pressure Plate Concept', cue: 'Focus on feeling pressure build in your trail foot during the backswing.' },
    ],
    youtubeSearch: 'golf reverse pivot fix weight transfer backswing',
    lessonQuestion: 'Is my weight going the wrong direction in the backswing, and is this connected to my thin/fat miss pattern?',
    expectedImprovement: 'Improved weight transfer and more powerful downswing from the right loading position.',
  },
  weight_stall: {
    name: 'Weight Stall',
    whatAISees: 'Lead hip is not moving toward the target through impact — weight appears to be hanging back on the trail side.',
    potentialResult: 'Flip at impact, high weak shots, slice, inconsistent contact.',
    drills: [
      { name: 'Left Foot Drill', cue: 'Hit shots off just your lead foot to train lead-side weight at impact.' },
      { name: 'Hip Bump Start', cue: 'Begin the downswing with a slight hip bump toward the target to "unlock" the lower body.' },
    ],
    youtubeSearch: 'golf weight transfer impact stall fix lead side',
    lessonQuestion: 'Am I hanging back because of a sequencing issue or because I\'m subconsciously trying to lift the ball, and which should I address first?',
    expectedImprovement: 'Better compression, improved trajectory, and straighter ball flight.',
  },
}

// ─── Main detection + ranking ─────────────────────────────────────────────────

interface RawDetection {
  id: IssueId
  severity: number
  detected: boolean
}

function priorityWeight(id: IssueId): number {
  // Faults that directly cause the most common ball-flight problems rank higher
  const weights: Record<IssueId, number> = {
    early_release: 1.4,
    flying_elbow: 1.2,
    loss_of_posture: 1.3,
    head_sway: 1.1,
    limited_hip_rotation: 1.2,
    limited_shoulder_turn: 1.0,
    reverse_pivot: 1.3,
    weight_stall: 1.2,
  }
  return weights[id] ?? 1.0
}

export function detectIssues(frames: FrameWithPose[]): {
  rankedIssues: RawDetection[]
  hasPoseData: boolean
} {
  const byPhase = new Map(frames.map((f) => [f.phase, f]))

  function lms(phase: FrameWithPose['phase']) {
    const f = byPhase.get(phase)
    return f?.pose?.detected ? f.pose.landmarks : null
  }

  const addressL = lms('address')
  const topL = lms('top')
  const downswingL = lms('downswing')
  const shaftDownL = lms('shaft_parallel_down')
  const impactL = lms('impact')

  const hasPoseData = frames.some((f) => f.pose?.detected)

  const detections: RawDetection[] = [
    { id: 'flying_elbow', ...detectFlyingElbow(topL) },
    { id: 'early_release', ...detectEarlyRelease(shaftDownL ?? downswingL, impactL) },
    { id: 'loss_of_posture', ...detectLossOfPosture(addressL, impactL) },
    { id: 'head_sway', ...detectHeadSway(addressL, impactL) },
    { id: 'limited_hip_rotation', ...detectLimitedHipRotation(addressL, impactL) },
    { id: 'limited_shoulder_turn', ...detectLimitedShoulderTurn(topL) },
    { id: 'reverse_pivot', ...detectReversePivot(addressL, topL) },
    { id: 'weight_stall', ...detectWeightStall(addressL, impactL) },
  ]

  const ranked = detections
    .filter((d) => d.detected && d.severity > 15)
    .map((d) => ({ ...d, score: d.severity * priorityWeight(d.id) }))
    .sort((a, b) => b.score - a.score)

  return { rankedIssues: ranked, hasPoseData }
}

// ─── Build full analysis ──────────────────────────────────────────────────────

export function buildAnalysisV2(
  frames: FrameWithPose[],
  annotatedFrameUrls: Partial<Record<IssueId, string>>,
): SwingAnalysisV2 {
  const { rankedIssues, hasPoseData } = detectIssues(frames)
  const top3 = rankedIssues.slice(0, 3)

  const issues: SwingIssue[] = top3.map((raw, i) => {
    const lib = ISSUE_LIBRARY[raw.id]
    const primaryPhase = issuePrimaryPhase(raw.id)
    return {
      id: raw.id,
      name: lib.name,
      priority: (i + 1) as 1 | 2 | 3,
      severity: Math.round(raw.severity),
      primaryPhase,
      whatAISees: lib.whatAISees,
      potentialResult: lib.potentialResult,
      drills: lib.drills,
      youtubeSearch: lib.youtubeSearch,
      lessonQuestion: lib.lessonQuestion,
      annotatedFrameUrl: annotatedFrameUrls[raw.id] ?? null,
    }
  })

  const allIssueIds = rankedIssues.map((d) => d.id)

  const coachPlanItems: CoachPlanItem[] = issues.map((issue) => {
    const lib = ISSUE_LIBRARY[issue.id]
    return {
      issueId: issue.id,
      name: lib.name,
      problem: lib.whatAISees,
      evidence: `Most visible at: ${issue.primaryPhase.replace(/_/g, ' ')}`,
      drills: lib.drills,
      youtubeSearch: lib.youtubeSearch,
      expectedImprovement: lib.expectedImprovement,
      primaryFrameUrl: annotatedFrameUrls[issue.id] ?? null,
    }
  })

  const lessonQuestions = [
    ...issues.map((i) => i.lessonQuestion),
    'Based on what you see in the video, what is the single highest-priority change I should make first?',
    'Are these swing faults connected — will fixing one naturally resolve the others?',
    'What is the fastest path to improvement for my handicap level?',
  ]

  return { issues, allIssueIds, hasPoseData, lessonQuestions, coachPlanItems }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

export function issuePrimaryPhase(id: IssueId): FrameWithPose['phase'] {
  const map: Record<IssueId, FrameWithPose['phase']> = {
    flying_elbow: 'top',
    early_release: 'shaft_parallel_down',
    loss_of_posture: 'impact',
    head_sway: 'impact',
    limited_hip_rotation: 'impact',
    limited_shoulder_turn: 'top',
    reverse_pivot: 'top',
    weight_stall: 'impact',
  }
  return map[id]
}
