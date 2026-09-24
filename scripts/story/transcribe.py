import argparse
import glob
import json
import os
import sys
import sysconfig
import time


def expose_cuda_libraries() -> None:
    root = os.path.join(sysconfig.get_paths()["purelib"], "nvidia")
    for folder in glob.glob(os.path.join(root, "*", "bin")):
        os.environ["PATH"] = folder + os.pathsep + os.environ.get("PATH", "")
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(folder)


expose_cuda_libraries()

FILLER_PROMPT = (
    "Umm, so, uh, I was like, you know, thinking. Hmm. Er, okay, ah, I- I mean, "
    "we we just, uh, like, shipped it."
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("out")
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()

    from faster_whisper import BatchedInferencePipeline, WhisperModel

    compute = "float16" if args.device == "cuda" else "int8"
    model = WhisperModel(args.model, device=args.device, compute_type=compute)
    pipeline = BatchedInferencePipeline(model=model)
    started = time.time()
    segments, info = pipeline.transcribe(
        args.audio,
        batch_size=args.batch,
        language="en",
        word_timestamps=True,
        initial_prompt=FILLER_PROMPT,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )

    words = []
    lines = []
    for segment in segments:
        lines.append({"s": round(segment.start, 3), "e": round(segment.end, 3), "text": segment.text.strip()})
        for word in segment.words or []:
            text = word.word.strip()
            if not text:
                continue
            words.append({"w": text, "s": round(word.start, 3), "e": round(word.end, 3), "p": round(word.probability, 3)})
        if len(lines) % 200 == 0:
            print(f"{segment.end / 60:.1f} min transcribed", file=sys.stderr, flush=True)

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "model": args.model,
                "language": info.language,
                "durationSec": round(info.duration, 3),
                "elapsedSec": round(time.time() - started, 1),
                "words": words,
                "segments": lines,
            },
            handle,
        )
    print(f"{len(words)} words in {time.time() - started:.0f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
