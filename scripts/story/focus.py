import json
import subprocess
import sys

import cv2
import numpy as np

W, H = 640, 360


def frames(video: str, start: float, end: float, fps: float):
    command = [
        "ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-i", video, "-t", f"{max(0.5, end - start):.3f}",
        "-an", "-vf", f"fps={fps},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ]
    data = subprocess.run(command, capture_output=True).stdout
    count = len(data) // (W * H)
    return np.frombuffer(data[: count * W * H], np.uint8).reshape(count, H, W)


def overlay_mask(exclude):
    mask = np.ones((H, W), np.float32)
    for x0, y0, x1, y1 in exclude:
        mask[int(y0 * H) : int(y1 * H), int(x0 * W) : int(x1 * W)] = 0
    return mask


def camera_pane(video, times, face):
    full_w, full_h = 1920, 1080
    grads_x, grads_y = [], []
    for t in times:
        command = ["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", "-vf", f"scale={full_w}:{full_h}",
                   "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]
        data = subprocess.run(command, capture_output=True).stdout
        if len(data) < full_w * full_h:
            continue
        img = np.frombuffer(data[: full_w * full_h], np.uint8).reshape(full_h, full_w).astype(np.float32)
        grads_x.append(np.abs(np.diff(img, axis=1)))
        grads_y.append(np.abs(np.diff(img, axis=0)))
    gx = np.median(np.stack(grads_x), axis=0)
    gy = np.median(np.stack(grads_y), axis=0)
    fx0, fy0 = int(face["x"] * full_w), int(face["y"] * full_h)
    fx1, fy1 = int((face["x"] + face["w"]) * full_w), int((face["y"] + face["h"]) * full_h)
    rows = slice(max(0, fy0), min(full_h, fy1 + (fy1 - fy0)))
    left_profile = gx[rows, : max(1, fx0 - 20)].mean(axis=0)
    left = int(np.argmax(left_profile[int(fx0 * 0.5):])) + int(fx0 * 0.5) + 1
    right_profile = gx[rows, fx1 + 20 :].mean(axis=0) if fx1 + 20 < full_w - 1 else np.zeros(1)
    right = full_w if right_profile.max() < left_profile.max() * 0.6 else fx1 + 20 + int(np.argmax(right_profile)) + 1
    cols = slice(left, min(full_w - 1, right - 1))
    below = gy[fy1 + 20 : min(full_h - 1, fy1 + 4 * (fy1 - fy0)), cols].mean(axis=1)
    bottom = fy1 + 20 + int(np.argmax(below)) + 1
    above = gy[: max(1, fy0 - 10), cols].mean(axis=1)
    top = 0 if above.size == 0 or above.max() < below.max() * 0.4 else int(np.argmax(above)) + 1
    return {"x0": left / full_w, "y0": top / full_h, "x1": right / full_w, "y1": bottom / full_h}


def main() -> int:
    video, spans_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    if spans_path == "--pane":
        request = json.loads(out_path)
        print(json.dumps(camera_pane(video, request["times"], request["face"])))
        return 0
    with open(spans_path, encoding="utf-8") as handle:
        request = json.load(handle)
    mask = overlay_mask(request["exclude"])
    out = {}
    for span in request["spans"]:
        stack = frames(video, span["start"], span["end"], 3.0)
        if len(stack) < 2:
            continue
        steps = np.abs(np.diff(stack.astype(np.int16), axis=0)).astype(np.float32)
        diff = cv2.GaussianBlur(steps.max(axis=0), (0, 0), 4) * mask
        moving = float(diff.mean())
        change = diff
        peak = float(change.max())
        box = None
        if peak > 4:
            binary = (change > peak * 0.35).astype(np.uint8)
            count, labels, stats, _ = cv2.connectedComponentsWithStats(binary)
            if count > 1:
                weights = [float(change[labels == k].sum()) for k in range(1, count)]
                k = int(np.argmax(weights)) + 1
                x0, y0, bw, bh, _ = stats[k]
                share_of_change = weights[k - 1] / (sum(weights) + 1e-6)
                box = {"x": round((x0 + bw / 2) / W, 4), "y": round((y0 + bh / 2) / H, 4), "w": round(bw / W, 4), "h": round(bh / H, 4), "dominance": round(share_of_change, 3)}
        out[span["id"]] = {"peak": round(peak, 2), "motion": round(moving, 3), "box": box}
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(out, handle)
    print(f"{len(out)} focus windows", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
