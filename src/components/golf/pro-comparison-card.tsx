'use client'

import { useState } from 'react'
import { TrendingUp, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import type { SwingAnalysisV2 } from '@/lib/golf/types'
import type { FrameWithPose } from '@/lib/golf/types'
import { PRO_TEMPLATES, compareWithPro } from '@/lib/golf/pro-templates'
import { cn } from '@/lib/utils'

interface Props {
  frames: FrameWithPose[]
  analysis: SwingAnalysisV2 | null
}

function deriveUserMetrics(frames: FrameWithPose[]) {
  const byPhase = new Map(frames.map((f) => [f.phase, f]))

  function lms(phase: FrameWithPose['phase']) {
    const f = byPhase.get(phase)
    return f?.pose?.detected ? f.pose.landmarks : null
  }

  function kp(lms_: ReturnType<typeof lms>, name: string) {
    return lms_?.find((l) => l.name === name) ?? null
  }

  function mid(a: { x: number; y: number } | null, b: { x: number; y: number } | null) {
    if (!a || !b) return null
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  function lineAngle(p1: { x: number; y: number } | null, p2: { x: number; y: number } | null) {
    if (!p1 || !p2) return null
    return Math.abs(Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI))
  }

  const addressL = lms('address')
  const topL = lms('top')
  const impactL = lms('impact')

  const addrLs = addressL ? kp(addressL, 'left_shoulder') : null
  const addrRs = addressL ? kp(addressL, 'right_shoulder') : null
  const addrLh = addressL ? kp(addressL, 'left_hip') : null
  const addrRh = addressL ? kp(addressL, 'right_hip') : null

  const addrShMid = mid(addrLs, addrRs)
  const addrHipMid = mid(addrLh, addrRh)

  const spineAngleAtAddress = addrShMid && addrHipMid
    ? Math.abs(Math.atan2(Math.abs(addrShMid.x - addrHipMid.x), Math.abs(addrShMid.y - addrHipMid.y)) * 180 / Math.PI)
    : null

  const topLs = topL ? kp(topL, 'left_shoulder') : null
  const topRs = topL ? kp(topL, 'right_shoulder') : null
  const shoulderTurnAtTop = lineAngle(topLs, topRs)

  const impLh = impactL ? kp(impactL, 'left_hip') : null
  const impRh = impactL ? kp(impactL, 'right_hip') : null
  const addrLhp = addressL ? kp(addressL, 'left_hip') : null
  const addrRhp = addressL ? kp(addressL, 'right_hip') : null

  const impHipAngle = lineAngle(impLh, impRh)
  const addrHipAngle = lineAngle(addrLhp, addrRhp)
  const hipRotationAtImpact = impHipAngle !== null && addrHipAngle !== null
    ? Math.abs(impHipAngle - addrHipAngle)
    : null

  // Spine consistency
  const impLs = impactL ? kp(impactL, 'left_shoulder') : null
  const impRs = impactL ? kp(impactL, 'right_shoulder') : null
  const impLhp = impactL ? kp(impactL, 'left_hip') : null
  const impRhp = impactL ? kp(impactL, 'right_hip') : null
  const impShMid = mid(impLs, impRs)
  const impHipMid = mid(impLhp, impRhp)
  const impSpine = impShMid && impHipMid
    ? Math.abs(Math.atan2(Math.abs(impShMid.x - impHipMid.x), Math.abs(impShMid.y - impHipMid.y)) * 180 / Math.PI)
    : null
  const spineAngleConsistency = spineAngleAtAddress !== null && impSpine !== null
    ? Math.abs(impSpine - spineAngleAtAddress)
    : null

  // Head movement
  const addrNose = addressL ? kp(addressL, 'nose') : null
  const impNose = impactL ? kp(impactL, 'nose') : null
  const headMovement = addrNose && impNose
    ? Math.sqrt((impNose.x - addrNose.x) ** 2 + (impNose.y - addrNose.y) ** 2)
    : null

  return {
    spineAngleAtAddress,
    shoulderTurnAtTop,
    hipRotationAtImpact,
    spineAngleConsistency,
    headMovement,
  }
}

const statusConfig = {
  good: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Matches' },
  close: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Close' },
  off: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', label: 'Gap' },
}

export function ProComparisonCard({ frames, analysis }: Props) {
  const [selectedProId, setSelectedProId] = useState('scottie')

  const userMetrics = deriveUserMetrics(frames)
  const selectedPro = PRO_TEMPLATES.find((p) => p.id === selectedProId) ?? PRO_TEMPLATES[0]
  const comparisons = analysis ? compareWithPro(selectedProId, userMetrics) : []

  // Find user's impact frame
  const impactFrame = frames.find((f) => f.phase === 'impact')

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[var(--panel)] shadow-xl">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/20">
            <TrendingUp className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div>
            <span className="rounded-md bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
              Step 5
            </span>
            <h2 className="text-sm font-semibold text-white">Pro Comparison</h2>
          </div>
        </div>

        {/* Pro selector */}
        <div className="mt-4 flex flex-wrap gap-2">
          {PRO_TEMPLATES.map((pro) => (
            <button
              key={pro.id}
              onClick={() => setSelectedProId(pro.id)}
              className={cn(
                'flex flex-col items-start rounded-xl px-3 py-2 text-left text-xs transition',
                selectedProId === pro.id
                  ? 'bg-[var(--accent)] text-black'
                  : 'bg-white/8 text-[var(--muted-foreground)] hover:bg-white/14 hover:text-white',
              )}
            >
              <span className="font-semibold">{pro.name}</span>
              <span className={cn('text-[10px]', selectedProId === pro.id ? 'text-black/60' : 'text-[var(--muted-foreground)]')}>
                {pro.style}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 pb-6 space-y-5">
        {/* Pro trait description */}
        <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
          <p className="text-xs font-semibold text-white">{selectedPro.name} — {selectedPro.style}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{selectedPro.traitDescription}</p>
        </div>

        {/* Side-by-side */}
        {!analysis ? (
          <div className="flex items-center justify-center rounded-2xl border border-white/8 bg-white/4 py-10">
            <p className="text-xs text-[var(--muted-foreground)]">Analyze a swing to see your comparison</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {/* User frame */}
              <div>
                <p className="mb-2 text-center text-xs font-semibold text-[var(--muted-foreground)]">Your Swing (Impact)</p>
                <div className="overflow-hidden rounded-xl bg-black ring-1 ring-white/8">
                  {impactFrame?.pose?.overlayDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={impactFrame.pose.overlayDataUrl} alt="Your impact" className="w-full" />
                  ) : (
                    <div className="flex h-32 items-center justify-center">
                      <p className="text-[10px] text-[#fff]/50">No frame</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Pro reference */}
              <div>
                <p className="mb-2 text-center text-xs font-semibold text-[var(--muted-foreground)]">{selectedPro.name} (Reference)</p>
                <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-[var(--accent)]/15 bg-[var(--accent)]/6">
                  <div className="text-center px-3">
                    <p className="text-xs font-semibold text-[var(--accent)]">{selectedPro.name}</p>
                    <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                      Hip turn: {selectedPro.referenceMetrics.hipRotationAtImpact}° at impact
                    </p>
                    <p className="text-[10px] text-[var(--muted-foreground)]">
                      Shoulder turn: {selectedPro.referenceMetrics.shoulderTurnAtTop}° at top
                    </p>
                    <p className="text-[10px] text-[var(--muted-foreground)]">
                      Spine angle: ±{selectedPro.referenceMetrics.spineAngleConsistency}° max change
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Metric comparison table */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
                Metric comparison
              </p>
              {comparisons.map((c, i) => {
                const cfg = statusConfig[c.status]
                const Icon = cfg.icon
                return (
                  <div
                    key={i}
                    className={cn('flex items-center gap-3 rounded-xl border p-3', cfg.bg, cfg.border)}
                  >
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', cfg.color)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white">{c.metricName}</p>
                      <p className="text-[10px] text-[var(--muted-foreground)]">{c.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn('text-xs font-bold tabular-nums', cfg.color)}>
                        {c.userValue !== null ? `${c.userValue}${c.unit}` : 'N/A'}
                      </p>
                      <p className="text-[10px] text-[var(--muted-foreground)]">
                        Pro: {c.proValue}{c.unit}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
