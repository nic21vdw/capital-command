import json
import re
import sys
import wave

import numpy as np
import torch
import torchaudio.functional as F
from torchaudio.pipelines import MMS_FA

RATE = 16000
PAD_BEFORE = 0.3
PAD_AFTER = 0.4


def letters(word: str) -> str:
    return re.sub(r"[^a-z']", "", word.lower()).replace("'", "")


def main() -> int:
    audio_path, spans_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(spans_path, encoding="utf-8") as handle:
        spans = json.load(handle)
    with wave.open(audio_path, "rb") as source:
        total = source.getnframes()
        pcm = np.frombuffer(source.readframes(total), dtype=np.int16)

    torch.set_num_threads(max(1, torch.get_num_threads()))
    model = MMS_FA.get_model(with_star=False)
    model.eval()
    dictionary = MMS_FA.get_dict(star=None)
    aligned = {}

    for number, span in enumerate(spans):
        start = max(0.0, span["start"] - PAD_BEFORE)
        end = min(total / RATE, span["end"] + PAD_AFTER)
        chunk = pcm[int(start * RATE) : int(end * RATE)].astype(np.float32) / 32768.0
        if len(chunk) < RATE // 4:
            continue
        words = [(item["i"], letters(item["w"])) for item in span["words"]]
        words = [(index, text) for index, text in words if text and all(ch in dictionary for ch in text)]
        if not words:
            continue
        targets = torch.tensor([[dictionary[ch] for _, text in words for ch in text]], dtype=torch.int32)
        with torch.inference_mode():
            emission, _ = model(torch.from_numpy(chunk).unsqueeze(0))
        if emission.size(1) < targets.size(1):
            continue
        try:
            labels, scores = F.forced_align(emission, targets, blank=0)
        except RuntimeError:
            continue
        token_spans = F.merge_tokens(labels[0], scores[0].exp())
        seconds_per_frame = (len(chunk) / RATE) / emission.size(1)
        cursor = 0
        for index, text in words:
            group = token_spans[cursor : cursor + len(text)]
            cursor += len(text)
            if not group:
                continue
            aligned[str(index)] = [
                round(start + group[0].start * seconds_per_frame, 3),
                round(start + group[-1].end * seconds_per_frame, 3),
                round(float(sum(item.score for item in group) / len(group)), 3),
            ]
        if (number + 1) % 25 == 0:
            print(f"{number + 1}/{len(spans)} spans aligned", file=sys.stderr, flush=True)

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(aligned, handle)
    print(f"{len(aligned)} words aligned", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
