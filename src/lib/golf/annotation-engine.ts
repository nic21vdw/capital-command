/**
 * Visual annotation engine.
 * Takes a frame data URL + landmarks and draws fault-specific overlays.
 * All operations run client-side in a Canvas 2D context.
 */

import type { PoseKeypoint, IssueId } from './types'

// ─── Drawing primitives ───────────────────────────────────────────────────────

function kp(lms: PoseKeypoint[], name: string): PoseKeypoint | null {
  return lms.find((l) => l.name === name) ?? null
}

function vis(p: PoseKeypoint | null, t = 0.35): p is PoseKeypoint {
  return p !== null && (p.visibility ?? 0) >= t
}

function px(v: number, size: number) {
  return v * size
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = url
  })
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  title: string,
  subtitle: string | null,
  bgColor: string,
  w: number,
) {
  const fs = Math.max(11, w * 0.022)
  const sfs = Math.max(9, w * 0.018)
  const pad = fs * 0.7
  const lineH = fs + pad * 0.5

  ctx.save()
  ctx.font = `bold ${fs}px ui-sans-serif, system-ui, sans-serif`
  const tw = ctx.measureText(title).width
  const sw = subtitle ? (() => {
    ctx.font = `${sfs}px ui-sans-serif, system-ui, sans-serif`
    return ctx.measureText(subtitle).width
  })() : 0
  const bw = Math.max(tw, sw) + pad * 2
  const bh = subtitle ? lineH * 2 + pad : lineH + pad

  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 8
  roundRect(ctx, x - bw / 2, y - bh / 2, bw, bh, 6)
  ctx.fillStyle = bgColor
  ctx.fill()
  ctx.shadowBlur = 0

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${fs}px ui-sans-serif, system-ui, sans-serif`
  ctx.fillText(title, x, subtitle ? y - lineH * 0.35 : y)

  if (subtitle) {
    ctx.font = `${sfs}px ui-sans-serif, system-ui, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.fillText(subtitle, x, y + lineH * 0.5)
  }
  ctx.restore()
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fx: number, fy: number,
  tx: number, ty: number,
  color: string,
  lw: number,
) {
  const angle = Math.atan2(ty - fy, tx - fx)
  const hs = lw * 3.5

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lw
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 6

  ctx.beginPath()
  ctx.moveTo(fx, fy)
  ctx.lineTo(tx, ty)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.lineTo(tx - hs * Math.cos(angle - Math.PI / 7), ty - hs * Math.sin(angle - Math.PI / 7))
  ctx.lineTo(tx - hs * Math.cos(angle + Math.PI / 7), ty - hs * Math.sin(angle + Math.PI / 7))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  color: string,
  lw: number,
  dash: number[] = [8, 5],
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.setLineDash(dash)
  ctx.shadowColor = 'rgba(0,0,0,0.4)'
  ctx.shadowBlur = 4
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

function drawGlowCircle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  color: string, lw: number,
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.shadowColor = color
  ctx.shadowBlur = 18
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.shadowBlur = 0
  // Thin fill tint
  ctx.fillStyle = color.replace(')', ', 0.12)').replace('rgb', 'rgba')
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// ─── Fault annotators ─────────────────────────────────────────────────────────

function annotateEarlyRelease(
  ctx: CanvasRenderingContext2D,
  lms: PoseKeypoint[],
  w: number,
  h: number,
) {
  const rWrist = kp(lms, 'right_wrist')
  const rElbow = kp(lms, 'right_elbow')
  if (!vis(rWrist) || !vis(rElbow)) return

  const wx = px(rWrist.x, w)
  const wy = px(rWrist.y, h)
  const ex = px(rElbow.x, w)
  const ey = px(rElbow.y, h)
  const r = w * 0.045

  // Red alert circle around wrist/hands
  drawGlowCircle(ctx, wx, wy, r, '#ef4444', Math.max(2, w * 0.004))

  // Yellow dashed line showing shaft direction (extend from elbow through wrist)
  const dx = wx - ex
  const dy = wy - ey
  const len = Math.sqrt(dx * dx + dy * dy)
  const nx = dx / len
  const ny = dy / len
  drawDashedLine(ctx, ex, ey, wx + nx * r * 2.5, wy + ny * r * 2.5, '#fbbf24', Math.max(2, w * 0.003), [10, 6])

  // Casting arc arrow
  const arcR = r * 1.6
  ctx.save()
  ctx.strokeStyle = '#ef4444'
  ctx.lineWidth = Math.max(2, w * 0.003)
  ctx.shadowColor = '#ef4444'
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.arc(ex, ey, arcR, Math.atan2(dy, dx) - 0.5, Math.atan2(dy, dx) + 0.5)
  ctx.stroke()
  ctx.restore()

  // Label
  drawLabel(ctx, wx, wy - r * 1.8, 'Possible Early Release', 'Club angle lost before impact', 'rgba(185, 28, 28, 0.92)', w)
}

function annotateFlyingElbow(
  ctx: CanvasRenderingContext2D,
  lms: PoseKeypoint[],
  w: number,
  h: number,
) {
  const rElbow = kp(lms, 'right_elbow')
  const rShoulder = kp(lms, 'right_shoulder')
  const lShoulder = kp(lms, 'left_shoulder')
  if (!vis(rElbow) || !vis(rShoulder) || !vis(lShoulder)) return

  const ex = px(rElbow.x, w)
  const ey = px(rElbow.y, h)
  const sy = px(rShoulder.y, h)
  const r = w * 0.042

  // Circle around elbow
  drawGlowCircle(ctx, ex, ey, r, '#ef4444', Math.max(2, w * 0.004))

  // Horizontal dashed shoulder-level line
  drawDashedLine(ctx, 0, sy, w, sy, '#6366f1', Math.max(2, w * 0.003), [12, 6])
  drawLabel(ctx, w * 0.5, sy - w * 0.025, 'Shoulder level reference', null, 'rgba(79, 70, 229, 0.88)', w)

  // Downward arrow from elbow to where it should be
  const targetY = sy + (ey - sy) * 0.2  // below shoulder
  if (ey < sy) {  // elbow is above shoulder (in image coords, lower y = higher up)
    drawArrow(ctx, ex, ey + r, ex, targetY - r, '#10b981', Math.max(2, w * 0.004))
    drawLabel(ctx, ex, ey - r * 1.8, 'Flying Elbow', 'Keep elbow tucked down', 'rgba(185, 28, 28, 0.92)', w)
  }
}

function annotateHeadSway(
  ctx: CanvasRenderingContext2D,
  addressLms: PoseKeypoint[],
  currentLms: PoseKeypoint[],
  w: number,
  h: number,
) {
  const aNose = kp(addressLms, 'nose')
  const cNose = kp(currentLms, 'nose')
  if (!vis(aNose) || !vis(cNose)) return

  const ax = px(aNose.x, w)
  const ay = px(aNose.y, h)
  const cx = px(cNose.x, w)
  const cy = px(cNose.y, h)
  const r = w * 0.038
  const dist = Math.sqrt((cx - ax) ** 2 + (cy - ay) ** 2)
  const pixelsPerUnit = w  // since coords are normalised 0-1

  // Ghost circle at address
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = Math.max(2, w * 0.003)
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.arc(ax, ay, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fill()
  ctx.setLineDash([])
  ctx.restore()
  drawLabel(ctx, ax, ay - r * 1.7, 'Address', null, 'rgba(80,80,80,0.85)', w)

  // Current head (red if excessive movement)
  const excessive = dist > pixelsPerUnit * 0.07
  const headColor = excessive ? '#ef4444' : '#fbbf24'
  drawGlowCircle(ctx, cx, cy, r, headColor, Math.max(2, w * 0.004))

  // Arrow connecting the two
  if (dist > 10) {
    drawArrow(ctx, ax, ay, cx, cy, headColor, Math.max(2, w * 0.003))
  }

  const cms = ((dist / pixelsPerUnit) * 100).toFixed(0)
  drawLabel(
    ctx, cx, cy - r * 1.8,
    excessive ? 'Head Sway Detected' : 'Head Movement',
    `~${cms}% of frame width`,
    excessive ? 'rgba(185,28,28,0.92)' : 'rgba(146,104,14,0.92)',
    w,
  )
}

function annotateLossOfPosture(
  ctx: CanvasRenderingContext2D,
  addressLms: PoseKeypoint[],
  currentLms: PoseKeypoint[],
  w: number,
  h: number,
) {
  // Compute spine lines for both frames and overlay on current frame
  function spinePoints(lms: PoseKeypoint[]) {
    const ls = kp(lms, 'left_shoulder')
    const rs = kp(lms, 'right_shoulder')
    const lh = kp(lms, 'left_hip')
    const rh = kp(lms, 'right_hip')
    if (!vis(ls) || !vis(rs) || !vis(lh) || !vis(rh)) return null
    return {
      top: { x: (ls.x + rs.x) / 2 * w, y: (ls.y + rs.y) / 2 * h },
      bot: { x: (lh.x + rh.x) / 2 * w, y: (lh.y + rh.y) / 2 * h },
    }
  }

  const ref = spinePoints(addressLms)
  const cur = spinePoints(currentLms)
  if (!ref || !cur) return

  // Extend lines slightly beyond shoulders
  function extendLine(top: { x: number; y: number }, bot: { x: number; y: number }, factor: number) {
    const dx = top.x - bot.x
    const dy = top.y - bot.y
    return { x: bot.x - dx * factor, y: bot.y - dy * factor }
  }

  const refExt = extendLine(ref.top, ref.bot, 0.3)
  const curExt = extendLine(cur.top, cur.bot, 0.3)

  // Green dashed = address reference
  drawDashedLine(ctx, ref.bot.x, ref.bot.y, refExt.x, refExt.y, '#10b981', Math.max(3, w * 0.004), [10, 5])
  drawLabel(ctx, refExt.x + w * 0.04, refExt.y, 'Address spine', null, 'rgba(5,122,85,0.88)', w)

  // Red solid = current
  const lw = Math.max(3, w * 0.004)
  ctx.save()
  ctx.strokeStyle = '#ef4444'
  ctx.lineWidth = lw
  ctx.shadowColor = '#ef4444'
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.moveTo(cur.bot.x, cur.bot.y)
  ctx.lineTo(curExt.x, curExt.y)
  ctx.stroke()
  ctx.restore()

  // Angle values
  function spineAngle(top: { x: number; y: number }, bot: { x: number; y: number }) {
    const dx = top.x - bot.x
    const dy = top.y - bot.y
    return Math.abs(Math.atan2(Math.abs(dx), Math.abs(dy)) * (180 / Math.PI))
  }
  const refAngle = spineAngle(ref.top, ref.bot)
  const curAngle = spineAngle(cur.top, cur.bot)
  const diff = Math.abs(curAngle - refAngle)

  drawLabel(
    ctx,
    cur.top.x,
    cur.top.y - h * 0.06,
    diff > 8 ? 'Loss of Posture' : 'Spine Angle',
    `Δ ${diff.toFixed(1)}°  (ref: ${refAngle.toFixed(0)}°  now: ${curAngle.toFixed(0)}°)`,
    diff > 8 ? 'rgba(185,28,28,0.92)' : 'rgba(5,122,85,0.88)',
    w,
  )
}

function annotateHipRotation(
  ctx: CanvasRenderingContext2D,
  addressLms: PoseKeypoint[],
  currentLms: PoseKeypoint[],
  w: number,
  h: number,
) {
  function hipMid(lms: PoseKeypoint[]) {
    const l = kp(lms, 'left_hip')
    const r = kp(lms, 'right_hip')
    if (!vis(l) || !vis(r)) return null
    return {
      mid: { x: (l.x + r.x) / 2 * w, y: (l.y + r.y) / 2 * h },
      left: { x: l.x * w, y: l.y * h },
      right: { x: r.x * w, y: r.y * h },
      angle: Math.atan2(r.y - l.y, r.x - l.x) * (180 / Math.PI),
    }
  }

  const aHip = hipMid(addressLms)
  const cHip = hipMid(currentLms)
  if (!aHip || !cHip) return

  // Draw current hip line
  const lw = Math.max(3, w * 0.004)
  ctx.save()
  ctx.strokeStyle = '#fbbf24'
  ctx.lineWidth = lw
  ctx.shadowColor = '#fbbf24'
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.moveTo(cHip.left.x, cHip.left.y)
  ctx.lineTo(cHip.right.x, cHip.right.y)
  ctx.stroke()

  // Draw address hip line (reference, green dashed)
  ctx.strokeStyle = '#10b981'
  ctx.lineWidth = lw
  ctx.setLineDash([8, 5])
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 0
  ctx.beginPath()
  ctx.moveTo(aHip.left.x, aHip.left.y)
  ctx.lineTo(aHip.right.x, aHip.right.y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  const rotation = Math.abs(cHip.angle - aHip.angle)
  const limited = rotation < 20

  drawLabel(
    ctx,
    cHip.mid.x,
    cHip.mid.y - h * 0.08,
    limited ? 'Limited Hip Rotation' : 'Hip Rotation',
    `~${rotation.toFixed(0)}°${limited ? ' — target 30°+' : ''}`,
    limited ? 'rgba(185,28,28,0.92)' : 'rgba(5,122,85,0.88)',
    w,
  )
}

function annotateLimitedShoulderTurn(
  ctx: CanvasRenderingContext2D,
  lms: PoseKeypoint[],
  w: number,
  h: number,
) {
  const ls = kp(lms, 'left_shoulder')
  const rs = kp(lms, 'right_shoulder')
  if (!vis(ls) || !vis(rs)) return

  const lx = px(ls.x, w), ly = px(ls.y, h)
  const rx = px(rs.x, w), ry = px(rs.y, h)

  const lw = Math.max(3, w * 0.004)
  ctx.save()
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = lw
  ctx.shadowColor = '#f59e0b'
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.moveTo(lx, ly)
  ctx.lineTo(rx, ry)
  ctx.stroke()
  ctx.restore()

  const angle = Math.abs(Math.atan2(ry - ly, rx - lx) * (180 / Math.PI))
  const mid = { x: (lx + rx) / 2, y: (ly + ry) / 2 }
  const limited = angle < 20

  drawLabel(
    ctx,
    mid.x,
    mid.y - h * 0.07,
    limited ? 'Limited Shoulder Turn' : 'Shoulder Turn',
    `~${angle.toFixed(0)}°${limited ? ' — target 40°+' : ''}`,
    limited ? 'rgba(185,28,28,0.92)' : 'rgba(146,104,14,0.92)',
    w,
  )
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type AnnotationSpec =
  | { type: 'early_release'; landmarks: PoseKeypoint[] }
  | { type: 'flying_elbow'; landmarks: PoseKeypoint[] }
  | { type: 'head_sway'; landmarks: PoseKeypoint[]; addressLandmarks: PoseKeypoint[] }
  | { type: 'loss_of_posture'; landmarks: PoseKeypoint[]; addressLandmarks: PoseKeypoint[] }
  | { type: 'hip_rotation'; landmarks: PoseKeypoint[]; addressLandmarks: PoseKeypoint[] }
  | { type: 'limited_shoulder_turn'; landmarks: PoseKeypoint[] }

export async function createAnnotatedFrame(
  baseDataUrl: string,
  specs: AnnotationSpec[],
): Promise<string> {
  const img = await loadImg(baseDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const w = img.width
  const h = img.height

  for (const spec of specs) {
    switch (spec.type) {
      case 'early_release':
        annotateEarlyRelease(ctx, spec.landmarks, w, h)
        break
      case 'flying_elbow':
        annotateFlyingElbow(ctx, spec.landmarks, w, h)
        break
      case 'head_sway':
        annotateHeadSway(ctx, spec.addressLandmarks, spec.landmarks, w, h)
        break
      case 'loss_of_posture':
        annotateLossOfPosture(ctx, spec.addressLandmarks, spec.landmarks, w, h)
        break
      case 'hip_rotation':
        annotateHipRotation(ctx, spec.addressLandmarks, spec.landmarks, w, h)
        break
      case 'limited_shoulder_turn':
        annotateLimitedShoulderTurn(ctx, spec.landmarks, w, h)
        break
    }
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}

// Map IssueId to annotation type
export function issueIdToAnnotationType(id: IssueId): AnnotationSpec['type'] | null {
  const map: Partial<Record<IssueId, AnnotationSpec['type']>> = {
    early_release: 'early_release',
    flying_elbow: 'flying_elbow',
    head_sway: 'head_sway',
    loss_of_posture: 'loss_of_posture',
    limited_hip_rotation: 'hip_rotation',
    limited_shoulder_turn: 'limited_shoulder_turn',
  }
  return map[id] ?? null
}
