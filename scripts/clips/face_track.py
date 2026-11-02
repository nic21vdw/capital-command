import argparse
import json
import subprocess
import sys

import cv2
import numpy as np

WIDTH = 640
HEIGHT = 360


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("--model", required=True)
    parser.add_argument("--fps", type=float, default=2.0)
    parser.add_argument("--max-seconds", type=float, default=180.0)
    args = parser.parse_args()

    detector = cv2.FaceDetectorYN.create(args.model, "", (WIDTH, HEIGHT), 0.6, 0.3, 20)
    command = [
        "ffmpeg", "-v", "error", "-t", str(args.max_seconds), "-i", args.video, "-an",
        "-vf", f"fps={args.fps},scale={WIDTH}:{HEIGHT}:flags=bilinear",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    frame_bytes = WIDTH * HEIGHT * 3
    frames = []
    index = 0
    while True:
        raw = process.stdout.read(frame_bytes)
        if len(raw) < frame_bytes:
            break
        frame = np.frombuffer(raw, np.uint8).reshape(HEIGHT, WIDTH, 3)
        _, faces = detector.detect(frame)
        found = []
        if faces is not None:
            for face in faces:
                x, y, w, h = (float(v) for v in face[:4])
                found.append({
                    "x": round(x / WIDTH, 4),
                    "y": round(y / HEIGHT, 4),
                    "w": round(w / WIDTH, 4),
                    "h": round(h / HEIGHT, 4),
                    "score": round(float(face[14]), 3),
                })
        frames.append({"t": round(index / args.fps, 2), "faces": found})
        index += 1
    process.wait()
    json.dump({"fps": args.fps, "frames": frames}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
