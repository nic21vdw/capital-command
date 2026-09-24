import json
import os
import subprocess
import sys

W, H = 1080, 1920
CAM_H = 608
SCREEN_H = H - CAM_H
XFADE = 0.015
SCALE = "lanczos+accurate_rnd+full_chroma_int"


def even(value):
    return max(2, int(value) // 2 * 2)


def run(args, cwd=None):
    result = subprocess.run(args, capture_output=True, text=True, cwd=cwd)
    if result.returncode != 0:
        raise SystemExit(f"ffmpeg failed: {result.stderr[-3000:]}")
    return result.stderr


def source_runs(segments):
    runs = []
    for k, seg in enumerate(segments):
        if runs and seg["in"] >= segments[runs[-1]["members"][-1]]["out"] - 1e-6:
            runs[-1]["members"].append(k)
        else:
            runs.append({"members": [k]})
    for run_ in runs:
        run_["start"] = max(0.0, segments[run_["members"][0]]["in"] - 0.2)
        run_["end"] = segments[run_["members"][-1]]["out"] + 0.3
    return runs


def main_graph(plan, wide=False):
    segments = plan["segments"]
    runs = source_runs(segments)
    cam = plan["camera"]
    scr = plan["screen"]
    n = len(segments)
    lines = []
    for r, run_ in enumerate(runs):
        members = run_["members"]
        lines.append(f"[{r}:v]fps=30,split={len(members)}" + "".join(f"[vs{k}]" for k in members))
        lines.append(f"[{r}:a]aresample=48000,asplit={len(members)}" + "".join(f"[as{k}]" for k in members))
    run_of = {k: run_ for run_ in runs for k in run_["members"]}
    for k, seg in enumerate(segments):
        base = run_of[k]["start"]
        start, end = seg["in"] - base, seg["out"] - base
        crop = seg.get("screen", scr)
        sw, sh = even(crop["w"]), even(crop["h"])
        sx = int(min(max(crop["x"], 0), 1920 - sw))
        sy = int(min(max(crop["y"], 0), 1080 - sh))
        if wide:
            ww, wh = 1440, 810
            wx = int(min(max(sx + sw / 2 - ww / 2, 0), 1920 - ww))
            wy = int(min(max(sy + sh / 2 - wh / 2, 0), 1080 - wh))
            lines.append(
                f"[vs{k}]trim=start={start:.4f}:end={end:.4f},setpts=PTS-STARTPTS,split=2[c{k}][s{k}];"
                f"[c{k}]crop={cam['w']}:{cam['h']}:{cam['x']}:{cam['y']},scale=640:360:flags={SCALE},unsharp=5:5:0.4,pad=652:372:6:6:white[cc{k}];"
                f"[s{k}]crop={ww}:{wh}:{wx}:{wy},scale=1920:1080:flags={SCALE}[ss{k}];"
                f"[ss{k}][cc{k}]overlay=x={1920 - 652 - 36}:y=36,setsar=1[v{k}]"
            )
        else:
            lines.append(
                f"[vs{k}]trim=start={start:.4f}:end={end:.4f},setpts=PTS-STARTPTS,split=2[c{k}][s{k}];"
                f"[c{k}]crop={cam['w']}:{cam['h']}:{cam['x']}:{cam['y']},scale={W}:{CAM_H}:flags={SCALE},unsharp=5:5:0.6[cc{k}];"
                f"[s{k}]crop={sw}:{sh}:{sx}:{sy},scale={W}:{SCREEN_H}:flags={SCALE}[ss{k}];"
                f"[cc{k}][ss{k}]vstack=inputs=2,setsar=1[v{k}]"
            )
        lines.append(f"[as{k}]atrim=start={start:.4f}:end={end + XFADE:.4f},asetpts=PTS-STARTPTS[a{k}]")
    lines.append("".join(f"[v{k}]" for k in range(n)) + f"concat=n={n}:v=1:a=0,format=yuv420p[vbase]")
    cur = "a0"
    for k in range(1, n):
        nxt = "aj" if k == n - 1 else f"ax{k}"
        lines.append(f"[{cur}][a{k}]acrossfade=d={XFADE}:c1=tri:c2=tri[{nxt}]")
        cur = nxt
    if n == 1:
        lines.append("[a0]anull[aj]")
    total = sum(s["out"] - s["in"] for s in segments)
    lines.append(f"[aj]atrim=end={total:.4f},asetpts=PTS-STARTPTS,highpass=f=70,afftdn=nr=8:nf=-45[aclean]")

    video = "vbase"
    for i, card in enumerate(plan.get("broll", [])):
        idx = i + len(runs)
        cw = 900 if wide else card.get("width", 940)
        at, dur = card["at"], card["dur"]
        cx = 60 if wide else (W - cw - 16) // 2
        cy = 120 if wide else CAM_H + card.get("top", 330)
        if card.get("text"):
            ch = even(cw * 0.42)
            size = int(ch / (len(card["text"]) + 0.6))
            draws = ",".join(
                f"drawtext=fontfile=../fonts/Montserrat-Black.ttf:text='{line}':fontcolor={'0xFFE500' if n == 0 else 'white'}:fontsize={size}:"
                f"x=(w-text_w)/2:y={int(ch * (n + 0.5) / len(card['text']) - size / 2)}"
                for n, line in enumerate(card["text"])
            )
            source = f"[{idx}:v]format=yuv420p,{draws},"
        else:
            ch = even(cw * card["crop"]["h"] / card["crop"]["w"])
            source = (
                f"[{idx}:v]fps=30,crop={card['crop']['w']}:{card['crop']['h']}:{card['crop']['x']}:{card['crop']['y']},"
                f"scale={cw}:{ch}:flags={SCALE},"
            )
        lines.append(
            source + f"pad={cw + 16}:{ch + 16}:8:8:white,format=yuva420p,"
            f"fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st={max(0.2, dur - 0.2):.3f}:d=0.2:alpha=1,"
            f"setpts=PTS-STARTPTS+{at:.3f}/TB[b{i}]"
        )
        out = f"vb{i}"
        lines.append(
            f"[{video}][b{i}]overlay=x={cx}:y='{cy}+70*max(0,1-(t-{at:.3f})/0.22)':eval=frame:eof_action=pass:"
            f"enable='between(t,{at:.3f},{at + dur:.3f})'[{out}]"
        )
        video = out
    lines.append(f"[{video}]subtitles={'captions_wide.ass' if wide else 'captions.ass'}:fontsdir='{plan['fontsDir']}'[vcap]")
    return ";\n".join(lines), total


def main():
    plan_path = sys.argv[1]
    plan = json.load(open(plan_path, encoding="utf-8"))
    wide = len(sys.argv) > 2 and sys.argv[2] == "wide"
    work = os.path.dirname(os.path.abspath(plan_path))
    graph, total = main_graph(plan, wide)
    out_path = plan["outWide"] if wide else plan["out"]
    inputs = []
    for run_ in source_runs(plan["segments"]):
        inputs += ["-ss", f"{run_['start']:.3f}", "-to", f"{run_['end']:.3f}", "-i", plan["source"]]
    for card in plan.get("broll", []):
        if card.get("text"):
            cw = 900 if wide else card.get("width", 940)
            inputs += ["-f", "lavfi", "-t", f"{card['dur'] + 0.3:.3f}", "-i", f"color=c=0x101014:s={cw}x{even(cw * 0.42)}:r=30"]
        else:
            inputs += ["-ss", f"{card['source']:.3f}", "-t", f"{card['dur'] + 0.3:.3f}", "-i", plan["source"]]

    measure_graph = graph + ";\n[aclean]loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[afin]"
    open(os.path.join(work, "measure.filter"), "w", encoding="utf-8").write(measure_graph)
    err = run(["ffmpeg", "-hide_banner", "-y", *inputs, "-/filter_complex", "measure.filter", "-map", "[vcap]", "-map", "[afin]", "-f", "null", "-"], cwd=work)
    m = json.loads(err[err.rfind("{"): err.rfind("}") + 1])
    final_graph = graph + (
        f";\n[aclean]loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
        f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample=48000[afin]"
    )
    open(os.path.join(work, "final.filter"), "w", encoding="utf-8").write(final_graph)
    run([
        "ffmpeg", "-hide_banner", "-v", "error", "-y", *inputs, "-/filter_complex", "final.filter",
        "-map", "[vcap]", "-map", "[afin]", "-t", f"{total:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "30", "-g", "15", "-bf", "2",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out_path,
    ], cwd=work)
    print(json.dumps({"out": out_path, "seconds": round(total, 2)}))


if __name__ == "__main__":
    main()
