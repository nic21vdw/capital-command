import type {
  FrameWithPose,
  SwingAnalysis,
  SwingMetric,
  MetricAssessment,
  PoseKeypoint,
} from './types'

// --- geometry helpers ---
function angle2D(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI)
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function kp(landmarks: PoseKeypoint[], name: string) {
  return landmarks.find((l) => l.name === name) ?? null
}

function visible(p: PoseKeypoint | null, threshold = 0.4): p is PoseKeypoint {
  return p !== null && (p.visibility ?? 0) >= threshold
}

// spine-to-vertical angle: 0 = perfectly upright, 90 = horizontal
function spineAngle(landmarks: PoseKeypoint[]): number | null {
  const lShoulder = kp(landmarks, 'left_shoulder')
  const rShoulder = kp(landmarks, 'right_shoulder')
  const lHip = kp(landmarks, 'left_hip')
  const rHip = kp(landmarks, 'right_hip')
  if (
    !visible(lShoulder) || !visible(rShoulder) ||
    !visible(lHip) || !visible(rHip)
  ) return null
  const shoulders = midpoint(lShoulder, rShoulder)
  const hips = midpoint(lHip, rHip)
  const dy = shoulders.y - hips.y
  const dx = shoulders.x - hips.x
  // angle of spine from vertical (in degrees); image Y increases downward
  return Math.abs(Math.atan2(Math.abs(dx), Math.abs(dy)) * (180 / Math.PI))
}

// angle of shoulder line from horizontal
function shoulderLineAngle(landmarks: PoseKeypoint[]): number | null {
  const l = kp(landmarks, 'left_shoulder')
  const r = kp(landmarks, 'right_shoulder')
  if (!visible(l) || !visible(r)) return null
  return Math.abs(angle2D(l, r))
}

// angle of hip line from horizontal
function hipLineAngle(landmarks: PoseKeypoint[]): number | null {
  const l = kp(landmarks, 'left_hip')
  const r = kp(landmarks, 'right_hip')
  if (!visible(l) || !visible(r)) return null
  return Math.abs(angle2D(l, r))
}

function metric(
  name: string,
  assessment: MetricAssessment,
  description: string,
  detail?: string,
): SwingMetric {
  return { name, assessment, description, detail }
}

function assessSpineAngleConsistency(
  addressAngle: number | null,
  impactAngle: number | null,
): SwingMetric {
  if (addressAngle === null || impactAngle === null) {
    return metric(
      'Spine Angle Consistency',
      'unknown',
      'Unable to measure — pose not detected on required frames.',
    )
  }
  const diff = Math.abs(impactAngle - addressAngle)
  if (diff < 5) {
    return metric(
      'Spine Angle Consistency',
      'good',
      'Spine angle is very consistent from address to impact.',
      `Change: ~${diff.toFixed(1)}°`,
    )
  }
  if (diff < 12) {
    return metric(
      'Spine Angle Consistency',
      'warning',
      'Slight spine angle change detected. Watch for early extension.',
      `Change: ~${diff.toFixed(1)}°`,
    )
  }
  return metric(
    'Spine Angle Consistency',
    'needs_work',
    'Significant spine angle change — possible early extension or reverse pivot.',
    `Change: ~${diff.toFixed(1)}°`,
  )
}

function assessPostureAtAddress(addressLandmarks: PoseKeypoint[] | null): SwingMetric {
  if (!addressLandmarks || addressLandmarks.length === 0) {
    return metric('Posture at Address', 'unknown', 'Pose not detected on address frame.')
  }
  const sa = spineAngle(addressLandmarks)
  if (sa === null) {
    return metric('Posture at Address', 'unknown', 'Key landmarks not visible in address frame.')
  }
  if (sa >= 28 && sa <= 48) {
    return metric(
      'Posture at Address',
      'good',
      'Good hip hinge and spine tilt at address.',
      `Spine angle: ~${sa.toFixed(0)}° from vertical`,
    )
  }
  if (sa < 20) {
    return metric(
      'Posture at Address',
      'needs_work',
      'Spine appears too upright — increase hip hinge for better coil.',
      `Spine angle: ~${sa.toFixed(0)}° from vertical`,
    )
  }
  if (sa > 55) {
    return metric(
      'Posture at Address',
      'warning',
      'Excessive forward bend detected — check ball position and setup distance.',
      `Spine angle: ~${sa.toFixed(0)}° from vertical`,
    )
  }
  return metric(
    'Posture at Address',
    'warning',
    'Spine angle is slightly outside the ideal 28–48° range.',
    `Spine angle: ~${sa.toFixed(0)}° from vertical`,
  )
}

function assessHeadMovement(
  addressLandmarks: PoseKeypoint[] | null,
  impactLandmarks: PoseKeypoint[] | null,
): SwingMetric {
  const aNose = addressLandmarks ? kp(addressLandmarks, 'nose') : null
  const iNose = impactLandmarks ? kp(impactLandmarks, 'nose') : null
  if (!visible(aNose) || !visible(iNose)) {
    return metric('Head Movement', 'unknown', 'Nose landmark not visible in required frames.')
  }
  const dx = Math.abs(iNose.x - aNose.x) // normalised 0-1
  const dy = Math.abs(iNose.y - aNose.y)

  if (dx < 0.04 && dy < 0.04) {
    return metric('Head Movement', 'good', 'Head remains very stable through impact — excellent.')
  }
  if (dx < 0.08 || dy < 0.06) {
    return metric(
      'Head Movement',
      'warning',
      dx > dy
        ? 'Slight lateral head sway detected. Try to keep the head centered over the ball.'
        : 'Slight vertical head dip. Check for "sitting down" into the shot.',
    )
  }
  return metric(
    'Head Movement',
    'needs_work',
    dx > dy
      ? 'Significant lateral head movement (sway). Focus on a stable head position.'
      : 'Excessive vertical head movement. Maintain posture through the swing.',
  )
}

function assessHipRotation(
  addressLandmarks: PoseKeypoint[] | null,
  impactLandmarks: PoseKeypoint[] | null,
): SwingMetric {
  const aAngle = addressLandmarks ? hipLineAngle(addressLandmarks) : null
  const iAngle = impactLandmarks ? hipLineAngle(impactLandmarks) : null
  if (aAngle === null || iAngle === null) {
    return metric('Hip Rotation', 'unknown', 'Hip landmarks not visible in required frames.')
  }
  const rotation = Math.abs(iAngle - aAngle)
  if (rotation >= 25) {
    return metric('Hip Rotation', 'good', 'Good hip rotation through to impact.', `~${rotation.toFixed(0)}° measured`)
  }
  if (rotation >= 12) {
    return metric(
      'Hip Rotation',
      'warning',
      'Moderate hip rotation — driving hips harder through impact may add power.',
      `~${rotation.toFixed(0)}° measured`,
    )
  }
  return metric(
    'Hip Rotation',
    'needs_work',
    'Limited hip rotation detected. Focus on clearing the lead hip through impact.',
    `~${rotation.toFixed(0)}° measured`,
  )
}

function assessShoulderTurn(topLandmarks: PoseKeypoint[] | null): SwingMetric {
  if (!topLandmarks || topLandmarks.length === 0) {
    return metric('Shoulder Turn', 'unknown', 'Pose not detected on top-of-backswing frame.')
  }
  const angle = shoulderLineAngle(topLandmarks)
  if (angle === null) {
    return metric('Shoulder Turn', 'unknown', 'Shoulder landmarks not visible at top of backswing.')
  }
  if (angle >= 38) {
    return metric('Shoulder Turn', 'good', 'Full shoulder turn achieved at the top.', `~${angle.toFixed(0)}° detected`)
  }
  if (angle >= 20) {
    return metric(
      'Shoulder Turn',
      'warning',
      'Partial shoulder turn — a more complete rotation may improve power.',
      `~${angle.toFixed(0)}° detected`,
    )
  }
  return metric(
    'Shoulder Turn',
    'needs_work',
    'Very limited shoulder turn detected. Flexibility work and a wider takeaway may help.',
    `~${angle.toFixed(0)}° detected`,
  )
}

function assessTrailElbow(topLandmarks: PoseKeypoint[] | null): SwingMetric {
  if (!topLandmarks || topLandmarks.length === 0) {
    return metric('Trail Elbow (Top)', 'unknown', 'Pose not detected on top-of-backswing frame.')
  }
  const elbow = kp(topLandmarks, 'right_elbow')
  const shoulder = kp(topLandmarks, 'right_shoulder')
  if (!visible(elbow) || !visible(shoulder)) {
    return metric('Trail Elbow (Top)', 'unknown', 'Right elbow/shoulder not visible at top.')
  }
  // In image coords, lower Y = higher on screen. Elbow should be at or below shoulder.
  const elbowAboveShoulder = elbow.y < shoulder.y
  if (!elbowAboveShoulder) {
    return metric('Trail Elbow (Top)', 'good', 'Trail elbow is in good position — not flying above shoulder.')
  }
  return metric(
    'Trail Elbow (Top)',
    'needs_work',
    'Flying trail elbow detected. Focus on keeping the right elbow pointed down at the top.',
  )
}

function assessWeightShift(
  addressLandmarks: PoseKeypoint[] | null,
  impactLandmarks: PoseKeypoint[] | null,
): SwingMetric {
  const aLHip = addressLandmarks ? kp(addressLandmarks, 'left_hip') : null
  const iLHip = impactLandmarks ? kp(impactLandmarks, 'left_hip') : null
  if (!visible(aLHip) || !visible(iLHip)) {
    return metric('Weight Shift', 'unknown', 'Hip landmarks insufficient to assess weight shift.')
  }
  // Lead hip should move toward target (decrease in x for a right-handed golfer, since camera sees left side)
  const shift = aLHip.x - iLHip.x
  if (shift > 0.04) {
    return metric('Weight Shift', 'good', 'Lead hip moves toward the target — good weight transfer.')
  }
  if (shift > 0) {
    return metric('Weight Shift', 'warning', 'Slight weight shift detected. Aim for a more pronounced transfer to the lead side.')
  }
  return metric(
    'Weight Shift',
    'needs_work',
    'Possible reverse pivot or lateral sway — weight may be staying on the trail side at impact.',
  )
}

function assessBalance(followLandmarks: PoseKeypoint[] | null): SwingMetric {
  if (!followLandmarks || followLandmarks.length === 0) {
    return metric('Balance Through Finish', 'unknown', 'Pose not detected on follow-through frame.')
  }
  const nose = kp(followLandmarks, 'nose')
  const lAnkle = kp(followLandmarks, 'left_ankle')
  const rAnkle = kp(followLandmarks, 'right_ankle')
  if (!visible(nose) || !visible(lAnkle) || !visible(rAnkle)) {
    return metric('Balance Through Finish', 'unknown', 'Key landmarks not visible in follow-through frame.')
  }
  const anklesMid = midpoint(lAnkle, rAnkle)
  const lateralOffset = Math.abs(nose.x - anklesMid.x)
  if (lateralOffset < 0.1) {
    return metric('Balance Through Finish', 'good', 'Head and base are well balanced at the finish.')
  }
  if (lateralOffset < 0.2) {
    return metric('Balance Through Finish', 'warning', 'Slight imbalance at finish. Try to finish tall and centered.')
  }
  return metric(
    'Balance Through Finish',
    'needs_work',
    'Significant imbalance at finish — focus on holding a stable, tall finish position.',
  )
}

// --- lesson questions (always generated) ---
function buildLessonQuestions(metrics: SwingMetric[]): string[] {
  const questions: string[] = []
  const byName = new Map(metrics.map((m) => [m.name, m]))

  const spine = byName.get('Spine Angle Consistency')
  if (spine?.assessment === 'needs_work' || spine?.assessment === 'warning') {
    questions.push('Am I losing spine angle through impact — and is that early extension or a reverse pivot?')
  }

  const head = byName.get('Head Movement')
  if (head?.assessment !== 'good') {
    questions.push('Is my head moving laterally or vertically, and how much is acceptable for my swing type?')
  }

  const elbow = byName.get('Trail Elbow (Top)')
  if (elbow?.assessment !== 'good') {
    questions.push('Does my trail elbow get stuck behind me at the top, and how does that affect my path?')
  }

  const weight = byName.get('Weight Shift')
  if (weight?.assessment !== 'good') {
    questions.push('Is my weight staying too far on my back foot through impact, and what drill would fix that?')
  }

  const hips = byName.get('Hip Rotation')
  const shoulders = byName.get('Shoulder Turn')
  if (hips?.assessment !== 'good' || shoulders?.assessment !== 'good') {
    questions.push('Should I work on takeaway path or hip rotation first given my current pattern?')
  }

  const balance = byName.get('Balance Through Finish')
  if (balance?.assessment !== 'good') {
    questions.push('Am I falling off-balance because of my lower body or upper body breakdown at the finish?')
  }

  // Pad with universal lesson-prep questions
  const universal = [
    'Based on what you see, what is the single highest-priority thing I should change first?',
    'Are my swing faults connected — is fixing one likely to resolve the others?',
    'What is a good 5-minute practice drill I can do at home or on the range this week?',
    'Is my miss pattern (pull, push, slice, hook) consistent with what you see in my positions?',
  ]

  for (const q of universal) {
    if (questions.length < 8) questions.push(q)
  }

  return questions
}

function buildFaultsAndTips(metrics: SwingMetric[]): { faults: string[]; tips: string[] } {
  const faults: string[] = []
  const tips: string[] = []

  for (const m of metrics) {
    if (m.assessment === 'needs_work') {
      faults.push(`${m.name}: ${m.description}`)
    }
  }

  const byName = new Map(metrics.map((m) => [m.name, m]))

  if (byName.get('Spine Angle Consistency')?.assessment !== 'good') {
    tips.push('Drill: address a wall behind you and maintain light contact through impact.')
  }
  if (byName.get('Head Movement')?.assessment !== 'good') {
    tips.push('Try the "seatbelt drill" — feel like your trail shoulder stays back while hips clear.')
  }
  if (byName.get('Hip Rotation')?.assessment !== 'good') {
    tips.push('Practice step-through swings to encourage full hip turn through impact.')
  }
  if (byName.get('Shoulder Turn')?.assessment !== 'good') {
    tips.push('Work on a shoulder-only rotation drill: arms crossed, focus on turning trail shoulder behind the ball.')
  }
  if (byName.get('Weight Shift')?.assessment !== 'good') {
    tips.push('Bump the lead hip slightly toward the target at the start of the downswing to promote weight transfer.')
  }
  if (byName.get('Balance Through Finish')?.assessment !== 'good') {
    tips.push('Practice holding your finish pose for 3 seconds to build balance awareness.')
  }

  if (tips.length === 0) {
    tips.push('Focus on maintaining tempo — a smooth transition from backswing to downswing protects all your good positions.')
  }

  return { faults, tips }
}

export function analyzeSwing(frames: FrameWithPose[]): SwingAnalysis {
  const byPhase = new Map(frames.map((f) => [f.phase, f]))

  const getLandmarks = (phase: FrameWithPose['phase']) =>
    byPhase.get(phase)?.pose?.detected ? (byPhase.get(phase)!.pose!.landmarks) : null

  const hasPoseData = frames.some((f) => f.pose?.detected)

  const addressL = getLandmarks('address')
  const topL = getLandmarks('top')
  const impactL = getLandmarks('impact')
  const followL = getLandmarks('follow_through')

  const addressSpine = addressL ? spineAngle(addressL) : null
  const impactSpine = impactL ? spineAngle(impactL) : null

  const metrics: SwingMetric[] = [
    assessPostureAtAddress(addressL),
    assessSpineAngleConsistency(addressSpine, impactSpine),
    assessHeadMovement(addressL, impactL),
    assessHipRotation(addressL, impactL),
    assessShoulderTurn(topL),
    assessTrailElbow(topL),
    assessWeightShift(addressL, impactL),
    assessBalance(followL),
  ]

  if (!hasPoseData) {
    return {
      metrics: metrics.map((m) => ({ ...m, assessment: 'unknown' as MetricAssessment })),
      faults: [],
      tips: [
        'Pose detection could not run on this video. Try better lighting, a stable camera, and ensure your full body is visible.',
        'Even without AI analysis, the frame timeline above shows your swing positions — compare them to reference images of your target positions.',
      ],
      lessonQuestions: buildLessonQuestions(metrics),
      hasPoseData: false,
    }
  }

  const { faults, tips } = buildFaultsAndTips(metrics)

  return {
    metrics,
    faults,
    tips,
    lessonQuestions: buildLessonQuestions(metrics),
    hasPoseData: true,
  }
}
