import subprocess
import sys


def main():
    video, out, count = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 15
    duration = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], capture_output=True, text=True).stdout)
    step = duration / count
    cols = 5
    rows = (count + cols - 1) // cols
    select = "+".join(f"eq(n\,{int((i + 0.5) * step * 30)})" for i in range(count))
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-i", video, "-vf",
        f"select='{select}',scale=270:480,drawtext=fontfile='C\:/Windows/Fonts/arialbd.ttf':text='%{{pts\:hms}}':x=6:y=6:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6,tile={cols}x{rows}",
        "-vsync", "vfr", "-frames:v", "1", out,
    ], check=True)


if __name__ == "__main__":
    main()
