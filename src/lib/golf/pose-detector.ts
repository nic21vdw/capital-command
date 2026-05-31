import type { PoseResult, PoseKeypoint } from './types'

// Lazily loaded so the heavy WASM bundle doesn't block the page
let landmarkerPromise: Promise<unknown> | null = null

async function getLandmarker() {
  if (landmarkerPromise) return landmarkerPromise

  landmarkerPromise = (async () => {
    const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm',
    )

    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      numPoses: 1,
    })
  })()

  return landmarkerPromise
}

function loadImageFromUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}

// Skeleton connection pairs following MediaPipe's POSE_CONNECTIONS ordering
const CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],
  [25, 27], [26, 28], [27, 29], [28, 30], [29, 31],
  [30, 32], [15, 17], [15, 19], [15, 21], [16, 18],
  [16, 20], [16, 22],
]

export async function detectPoseInFrame(dataUrl: string): Promise<PoseResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const landmarker = (await getLandmarker()) as any
  const img = await loadImageFromUrl(dataUrl)

  const result = landmarker.detect(img)
  const detected = result.landmarks && result.landmarks.length > 0

  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  const landmarks: PoseKeypoint[] = []

  if (detected) {
    const raw = result.landmarks[0] as { x: number; y: number; z: number; visibility: number }[]
    const kpNames = [
      'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
      'right_eye_inner', 'right_eye', 'right_eye_outer',
      'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
      'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
      'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
      'left_index', 'right_index', 'left_thumb', 'right_thumb',
      'left_hip', 'right_hip', 'left_knee', 'right_knee',
      'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
      'left_foot_index', 'right_foot_index',
    ]

    raw.forEach((kp, i) => {
      landmarks.push({
        name: kpNames[i] ?? `kp_${i}`,
        x: kp.x,
        y: kp.y,
        z: kp.z,
        visibility: kp.visibility,
      })
    })

    // Draw skeleton
    ctx.strokeStyle = '#00e5a0'
    ctx.lineWidth = Math.max(2, img.width * 0.003)
    for (const [a, b] of CONNECTIONS) {
      const kpA = raw[a]
      const kpB = raw[b]
      if (!kpA || !kpB) continue
      if ((kpA.visibility ?? 0) < 0.4 || (kpB.visibility ?? 0) < 0.4) continue
      ctx.beginPath()
      ctx.moveTo(kpA.x * img.width, kpA.y * img.height)
      ctx.lineTo(kpB.x * img.width, kpB.y * img.height)
      ctx.stroke()
    }

    // Draw keypoints
    const r = Math.max(4, img.width * 0.006)
    for (const kp of raw) {
      if ((kp.visibility ?? 0) < 0.4) continue
      ctx.beginPath()
      ctx.arc(kp.x * img.width, kp.y * img.height, r, 0, 2 * Math.PI)
      ctx.fillStyle = '#ff5f6d'
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }

  return {
    landmarks,
    overlayDataUrl: canvas.toDataURL('image/jpeg', 0.9),
    detected,
  }
}
