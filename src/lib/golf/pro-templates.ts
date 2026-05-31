import type { ProTemplate } from './types'

export const PRO_TEMPLATES: ProTemplate[] = [
  {
    id: 'rory',
    name: 'Rory McIlroy',
    style: 'Power & Rotation',
    traitDescription:
      'Explosive hip rotation (50°+ at impact), wide arc, very consistent spine angle, aggressive hip bump into the ball.',
    referenceMetrics: {
      spineAngleAtAddress: 38,
      shoulderTurnAtTop: 90,
      hipRotationAtImpact: 50,
      spineAngleConsistency: 5,
      headMovementThreshold: 0.04,
      trailElbowAngleAtTop: 85,
    },
  },
  {
    id: 'scottie',
    name: 'Scottie Scheffler',
    style: 'Controlled Power',
    traitDescription:
      'Incredibly consistent posture, textbook spine angle from address through finish, efficient hip turn with tight sequencing.',
    referenceMetrics: {
      spineAngleAtAddress: 36,
      shoulderTurnAtTop: 85,
      hipRotationAtImpact: 45,
      spineAngleConsistency: 4,
      headMovementThreshold: 0.03,
      trailElbowAngleAtTop: 90,
    },
  },
  {
    id: 'tiger',
    name: 'Tiger Woods',
    style: 'Classic Fundamentals',
    traitDescription:
      'Model spine angle maintenance, strong hip clearance, trail elbow perfectly tucked at top, wide-to-narrow arc.',
    referenceMetrics: {
      spineAngleAtAddress: 40,
      shoulderTurnAtTop: 92,
      hipRotationAtImpact: 48,
      spineAngleConsistency: 5,
      headMovementThreshold: 0.035,
      trailElbowAngleAtTop: 88,
    },
  },
  {
    id: 'nelly',
    name: 'Nelly Korda',
    style: 'Tempo & Efficiency',
    traitDescription:
      'Smooth tempo, excellent posture retention, efficient shoulder turn with very quiet head, balanced finish.',
    referenceMetrics: {
      spineAngleAtAddress: 35,
      shoulderTurnAtTop: 80,
      hipRotationAtImpact: 40,
      spineAngleConsistency: 5,
      headMovementThreshold: 0.03,
      trailElbowAngleAtTop: 82,
    },
  },
]

export interface ComparisonResult {
  metricName: string
  userValue: number | null
  proValue: number
  unit: string
  status: 'good' | 'close' | 'off'
  description: string
}

export function compareWithPro(
  proId: string,
  userMetrics: {
    spineAngleAtAddress: number | null
    shoulderTurnAtTop: number | null
    hipRotationAtImpact: number | null
    spineAngleConsistency: number | null
    headMovement: number | null
  },
): ComparisonResult[] {
  const template = PRO_TEMPLATES.find((p) => p.id === proId) ?? PRO_TEMPLATES[0]
  const ref = template.referenceMetrics

  function status(user: number | null, pro: number, tolerance: number): ComparisonResult['status'] {
    if (user === null) return 'off'
    const diff = Math.abs(user - pro)
    if (diff <= tolerance) return 'good'
    if (diff <= tolerance * 2.5) return 'close'
    return 'off'
  }

  return [
    {
      metricName: 'Spine angle at address',
      userValue: userMetrics.spineAngleAtAddress,
      proValue: ref.spineAngleAtAddress,
      unit: '°',
      status: status(userMetrics.spineAngleAtAddress, ref.spineAngleAtAddress, 8),
      description: 'Hip hinge and forward tilt at setup',
    },
    {
      metricName: 'Shoulder turn at top',
      userValue: userMetrics.shoulderTurnAtTop,
      proValue: ref.shoulderTurnAtTop,
      unit: '°',
      status: status(userMetrics.shoulderTurnAtTop, ref.shoulderTurnAtTop, 12),
      description: 'Total shoulder rotation at top of backswing',
    },
    {
      metricName: 'Hip rotation at impact',
      userValue: userMetrics.hipRotationAtImpact,
      proValue: ref.hipRotationAtImpact,
      unit: '°',
      status: status(userMetrics.hipRotationAtImpact, ref.hipRotationAtImpact, 12),
      description: 'Hip clearance compared to address',
    },
    {
      metricName: 'Spine angle change',
      userValue: userMetrics.spineAngleConsistency,
      proValue: ref.spineAngleConsistency,
      unit: '° max',
      status: userMetrics.spineAngleConsistency === null
        ? 'off'
        : userMetrics.spineAngleConsistency <= ref.spineAngleConsistency + 3
          ? 'good'
          : userMetrics.spineAngleConsistency <= ref.spineAngleConsistency + 8
            ? 'close'
            : 'off',
      description: 'Posture consistency from address to impact',
    },
    {
      metricName: 'Head lateral movement',
      userValue: userMetrics.headMovement !== null ? Math.round(userMetrics.headMovement * 1000) / 10 : null,
      proValue: Math.round(ref.headMovementThreshold * 1000) / 10,
      unit: '% frame',
      status: userMetrics.headMovement === null
        ? 'off'
        : userMetrics.headMovement <= ref.headMovementThreshold * 1.5
          ? 'good'
          : userMetrics.headMovement <= ref.headMovementThreshold * 2.5
            ? 'close'
            : 'off',
      description: 'Lateral head movement from address to impact',
    },
  ]
}
