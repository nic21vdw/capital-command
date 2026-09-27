import json
import os
import subprocess
import sys

import cv2
import numpy as np

FULL_W, FULL_H = 1920, 1080
HERE = os.path.dirname(os.path.abspath(__file__))


def arrow(scale):
    points = np.array([(0, 0), (0, 16), (4, 12), (7, 18), (9, 17), (6, 11), (11, 11)], np.float32) * scale + 2
    size = (int(13 * scale) + 5, int(20 * scale) + 5)
    image = np.full((size[1], size[0]), 128, np.uint8)
    mask = np.zeros_like(image)
    poly = points.astype(np.int32)
    cv2.fillPoly(mask, [poly], 255)
    cv2.polylines(mask, [poly], True, 255, max(1, int(round(scale))))
    cv2.fillPoly(image, [poly], 255)
    cv2.polylines(image, [poly], True, 0, max(1, int(round(scale))))
    return image, mask, (2, 2)


def templates():
    out = []
    for scale in (0.75, 1.0, 1.25):
        image, mask, hotspot = arrow(scale)
        out.append(("arrow", image, mask, hotspot))
    hand_path = os.path.join(HERE, "cursor-hand.png")
    if os.path.exists(hand_path):
        hand = cv2.imread(hand_path, cv2.IMREAD_GRAYSCALE)
        mask = (np.abs(hand.astype(np.int16) - int(np.median(hand))) > 40).astype(np.uint8) * 255
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8))
        out.append(("hand", hand, mask, (int(hand.shape[1] * 0.4), 1)))
    return out


def read_frames(video, start, end, fps):
    command = [
        "ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-i", video, "-t", f"{max(0.3, end - start):.3f}",
        "-an", "-vf", f"fps={fps},scale={FULL_W}:{FULL_H}", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ]
    data = subprocess.run(command, capture_output=True).stdout
    count = len(data) // (FULL_W * FULL_H)
    return np.frombuffer(data[: count * FULL_W * FULL_H], np.uint8).reshape(count, FULL_H, FULL_W)


def locate(frame, previous, kits, exclude):
    moving = None
    if previous is not None:
        diff = cv2.absdiff(frame, previous)
        moving = cv2.dilate((diff > 25).astype(np.uint8), np.ones((15, 15), np.uint8))
    best = (0.0, None, None)
    for name, image, mask, hotspot in kits:
        result = cv2.matchTemplate(frame, image, cv2.TM_CCORR_NORMED, mask=mask)
        result = np.nan_to_num(result, nan=0.0, posinf=0.0, neginf=0.0)
        if moving is not None:
            gate = moving[: result.shape[0], : result.shape[1]]
            weighted = result * (0.85 + 0.15 * gate)
        else:
            weighted = result
        _, value, _, loc = cv2.minMaxLoc(weighted)
        x = (loc[0] + hotspot[0]) / FULL_W
        y = (loc[1] + hotspot[1]) / FULL_H
        if any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in exclude):
            continue
        if value > best[0]:
            best = (float(value), (x, y), name)
    return best


def main() -> int:
    video, request_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(request_path, encoding="utf-8") as handle:
        request = json.load(handle)
    kits = templates()
    threshold = request.get("threshold", 0.93)
    out = {}
    for span in request["spans"]:
        stack = read_frames(video, span["start"], span["end"], request.get("fps", 4))
        hits = []
        previous = None
        for index, frame in enumerate(stack):
            score, point, name = locate(frame, previous, kits, request["exclude"])
            previous = frame
            if point and score >= threshold:
                hits.append({"t": round(span["start"] + index / request.get("fps", 4), 2), "x": round(point[0], 4), "y": round(point[1], 4), "score": round(score, 3), "kind": name})
        out[span["id"]] = hits
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(out, handle)
    print(f"{sum(len(v) for v in out.values())} cursor sightings in {len(out)} spans", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
