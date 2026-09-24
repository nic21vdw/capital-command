import json
import subprocess
import sys

import cv2
import numpy as np

FW, FH = 1920, 1080
SW, SH = 480, 270


def frames(video, start, end, fps):
    command = [
        "ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-i", video, "-t", f"{max(0.5, end - start):.3f}",
        "-an", "-vf", f"fps={fps},scale={SW}:{SH}", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ]
    data = subprocess.run(command, capture_output=True).stdout
    count = len(data) // (SW * SH)
    return np.frombuffer(data[: count * SW * SH], np.uint8).reshape(count, SH, SW)


def best(score, mask, win_w, win_h, y_max):
    penalty = (1 - mask) * (float(score.mean()) * 6 + 1e-3)
    s = cv2.integral((score - penalty).astype(np.float32))
    top = (0, 0, -1e18)
    for y in range(0, max(1, min(y_max, SH - win_h) + 1), 3):
        for x in range(0, SW - win_w + 1, 3):
            v = s[y + win_h, x + win_w] - s[y, x + win_w] - s[y + win_h, x] + s[y, x]
            if v > top[2]:
                top = (x, y, v)
    return top


def main():
    video, request_path = sys.argv[1], sys.argv[2]
    request = json.load(open(request_path, encoding="utf-8"))
    mask = np.ones((SH, SW), np.float32)
    for x0, y0, x1, y1 in request["exclude"]:
        mask[int(y0 * SH): int(y1 * SH), int(x0 * SW): int(x1 * SW)] = 0
    out = {}
    for item in request["items"]:
        stack = frames(video, item["start"], item["end"], item.get("fps", 1.0))
        if len(stack) == 0:
            continue
        edges = np.mean([cv2.Canny(f, 50, 150) for f in stack], axis=0).astype(np.float32)
        detail = cv2.GaussianBlur(edges, (0, 0), 6)
        detail /= detail.max() + 1e-6
        if len(stack) > 1:
            act = np.abs(np.diff(stack.astype(np.int16), axis=0)).astype(np.float32).mean(axis=0)
            act = cv2.GaussianBlur(act, (0, 0), 6)
            act /= act.max() + 1e-6
            score = detail * 0.5 + act * 0.5
        else:
            score = detail
        score *= mask
        win_w = int(item["w"] * SW / FW)
        win_h = int(item["h"] * SH / FH)
        x, y, _ = best(score, mask, win_w, win_h, int(item.get("yMax", FH) * SH / FH))
        out[item["id"]] = {"x": int(x * FW / SW), "y": int(y * FH / SH), "w": item["w"], "h": item["h"]}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
