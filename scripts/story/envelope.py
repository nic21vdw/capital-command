import sys

import numpy as np

HOP = 160


def main() -> int:
    source, out = sys.argv[1], sys.argv[2]
    audio = np.memmap(source, dtype=np.int16, mode="r", offset=44)
    frames = len(audio) // HOP
    levels = np.empty(frames, dtype=np.float32)
    step = 100_000
    for begin in range(0, frames, step):
        end = min(frames, begin + step)
        block = audio[begin * HOP : end * HOP].astype(np.float32).reshape(-1, HOP) / 32768.0
        rms = np.sqrt(np.mean(block * block, axis=1) + 1e-12)
        levels[begin:end] = 20 * np.log10(rms)
    levels.tofile(out)
    print(f"{frames} frames of {HOP / 16000:.3f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
