import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def run(args):
    subprocess.run(args, check=True, capture_output=True)


def main():
    clip_dir = sys.argv[1]
    clip = os.path.basename(os.path.normpath(clip_dir))
    vertical = os.path.join(clip_dir, f"{clip}.mp4")
    wide = os.path.join(clip_dir, f"{clip}-16x9.mp4")
    sheet = os.path.join(HERE, "review_sheet.py")
    run([sys.executable, sheet, vertical, os.path.join(clip_dir, "sheet.jpg"), "15"])
    if os.path.exists(wide):
        run([sys.executable, sheet, wide, os.path.join(clip_dir, "sheet_wide.jpg"), "10"])
    for name in os.listdir(clip_dir):
        if name.startswith("broll") and name.endswith(".jpg"):
            os.remove(os.path.join(clip_dir, name))
    plan = json.load(open(os.path.join(clip_dir, "plan.json"), encoding="utf-8"))
    for index, card in enumerate(plan.get("broll", []), start=1):
        at = card["at"] + card["dur"] / 2
        run(["ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", vertical, "-frames:v", "1", "-vf", "scale=540:-2,format=yuvj420p", os.path.join(clip_dir, f"broll{index}.jpg")])
    audio = os.path.join(clip_dir, "audio.wav")
    run(["ffmpeg", "-v", "error", "-y", "-i", vertical, "-ac", "1", "-ar", "16000", audio])
    run([sys.executable, os.path.join(HERE, "transcribe.py"), audio, os.path.join(clip_dir, "heard.json"), "--batch", "4"])
    os.remove(audio)
    heard = json.load(open(os.path.join(clip_dir, "heard.json"), encoding="utf-8"))
    with open(os.path.join(clip_dir, "heard.txt"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(f"[{s['s']:.1f}-{s['e']:.1f}] {s['text']}" for s in heard["segments"]))
    expected = len(json.load(open(os.path.join(clip_dir, "words.json"), encoding="utf-8")))
    got = len(heard["words"])
    flag = "" if got >= expected * 0.85 else "  WARNING: audio is missing words"
    print(f"{clip}: kit ready, heard {got}/{expected} words{flag}")


if __name__ == "__main__":
    main()
