import argparse
import json
import subprocess
import sys

import cv2
import numpy as np

WIDTH = 1280
HEIGHT = 720


def frontalness(face) -> float:
    right_eye = face[4:6]
    left_eye = face[6:8]
    nose = face[8:10]
    eye_span = abs(left_eye[0] - right_eye[0])
    if eye_span < 1:
        return 0.0
    mid = (left_eye[0] + right_eye[0]) / 2
    offset = abs(nose[0] - mid) / eye_span
    return float(max(0.0, 1.0 - offset * 2.2))


def region(gray, box, grow):
    x, y, w, h = box
    cx, cy = x + w / 2, y + h / 2
    gw, gh = w * grow, h * grow
    x0 = int(max(0, cx - gw / 2))
    y0 = int(max(0, cy - gh / 2))
    x1 = int(min(gray.shape[1], cx + gw / 2))
    y1 = int(min(gray.shape[0], cy + gh / 2))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    return gray[y0:y1, x0:x1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("out")
    parser.add_argument("--model", required=True)
    parser.add_argument("--fps", type=float, default=2.0)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--duration", type=float, default=0.0)
    args = parser.parse_args()

    detector = cv2.FaceDetectorYN.create(args.model, "", (WIDTH, HEIGHT), 0.6, 0.3, 20)
    command = ["ffmpeg", "-v", "error", "-hwaccel", "auto"]
    if args.start > 0:
        command += ["-ss", str(args.start)]
    command += ["-i", args.video]
    if args.duration > 0:
        command += ["-t", str(args.duration)]
    command += [
        "-an",
        "-vf",
        f"fps={args.fps},scale={WIDTH}:{HEIGHT}:flags=bilinear",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
        "pipe:1",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    frame_bytes = WIDTH * HEIGHT * 3
    samples = []
    previous_small = None
    previous_gray = None
    previous_hist = None
    index = 0
    while True:
        raw = process.stdout.read(frame_bytes)
        if len(raw) < frame_bytes:
            break
        frame = np.frombuffer(raw, np.uint8).reshape(HEIGHT, WIDTH, 3)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (160, 90), interpolation=cv2.INTER_AREA).astype(np.float32)
        hist = cv2.calcHist([small.astype(np.uint8)], [0], None, [32], [0, 256])
        cv2.normalize(hist, hist)

        motion = float(np.mean(np.abs(small - previous_small))) if previous_small is not None else 0.0
        cut = False
        if previous_hist is not None:
            cut = cv2.compareHist(previous_hist, hist, cv2.HISTCMP_CORREL) < 0.55 and motion > 18

        _, faces = detector.detect(frame)
        face = None
        if faces is not None and len(faces) > 0:
            best = max(faces, key=lambda f: f[2] * f[3] * f[14])
            x, y, w, h = [float(v) for v in best[:4]]
            face_gray = region(gray, (x, y, w, h), 1.0)
            body_now = region(gray, (x, y, w, h), 3.0)
            gesture = 0.0
            if previous_gray is not None and body_now is not None:
                body_before = region(previous_gray, (x, y, w, h), 3.0)
                if body_before is not None and body_before.shape == body_now.shape:
                    gesture = float(np.mean(cv2.absdiff(body_now, body_before)))
            face = {
                "x": round(x / WIDTH, 4),
                "y": round(y / HEIGHT, 4),
                "w": round(w / WIDTH, 4),
                "h": round(h / HEIGHT, 4),
                "conf": round(float(best[14]), 3),
                "front": round(frontalness(best), 3),
                "sharp": round(float(cv2.Laplacian(face_gray, cv2.CV_64F).var()), 1) if face_gray is not None else 0.0,
                "luma": round(float(np.mean(face_gray)), 1) if face_gray is not None else 0.0,
                "gesture": round(gesture, 2),
            }

        samples.append(
            {
                "t": round(args.start + index / args.fps, 2),
                "sharp": round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 1),
                "luma": round(float(np.mean(gray)), 1),
                "contrast": round(float(np.std(gray)), 1),
                "motion": round(motion, 2),
                "cut": cut,
                "face": face,
            }
        )
        previous_small = small
        previous_gray = gray
        previous_hist = hist
        index += 1
        if index % 1200 == 0:
            print(f"{index / args.fps / 60:.1f} min analysed", file=sys.stderr, flush=True)

    process.wait()
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump({"fps": args.fps, "width": WIDTH, "height": HEIGHT, "samples": samples}, handle)
    print(f"{len(samples)} samples", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
