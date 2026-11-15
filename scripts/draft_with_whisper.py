"""
Writes first-draft transcripts for the demo bank calls with a real speech model (Whisper via faster-whisper).

Each recording is cut into the segments of the call manifest and every segment is transcribed separately,
so drafts line up with the segments annotators correct. The output is raw model output, exactly as produced:
the seeder pseudonymises it on ingest like any other text, and the app shows it as a draft to be corrected.

Setup (once, in any virtual environment outside the repository):
    python -m venv .venv-whisper
    .venv-whisper/Scripts/python -m pip install faster-whisper==1.2.1
Run from the repository root:
    .venv-whisper/Scripts/python scripts/draft_with_whisper.py            # model base.en (~150 MB download)
    .venv-whisper/Scripts/python scripts/draft_with_whisper.py --model tiny.en

Output: backend/src/main/resources/fixtures/model-drafts/drafts.json
"""
import argparse
import datetime
import json
import pathlib
import wave

import faster_whisper
import numpy as np
from faster_whisper import WhisperModel

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "backend/src/main/resources/fixtures/calls/manifest.json"
AUDIO = ROOT / "backend/src/main/resources/audio"
OUT = ROOT / "backend/src/main/resources/fixtures/model-drafts/drafts.json"


def load_pcm(path: pathlib.Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        assert w.getnchannels() == 1 and w.getsampwidth() == 2, f"{path.name}: expected 16-bit mono"
        rate = w.getframerate()
        samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return samples.astype(np.float32) / 32768.0, rate


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="base.en")
    args = ap.parse_args()

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    drafts = {}
    for d in manifest["calls"]:
        audio, rate = load_pcm(AUDIO / f"{d['clipId']}.wav")
        assert rate == 16000, "Whisper expects 16 kHz audio"
        segments = []
        for s in d["segments"]:
            chunk = audio[int(s["startMs"] * rate / 1000): int(s["endMs"] * rate / 1000)]
            parts, _ = model.transcribe(chunk, language="en", beam_size=5, condition_on_previous_text=False, vad_filter=False)
            parts = list(parts)
            text = " ".join(p.text.strip() for p in parts).strip()
            segments.append({
                "id": s["id"],
                "text": text,
                "avgLogprob": round(min((p.avg_logprob for p in parts), default=0.0), 3),
                "noSpeechProb": round(max((p.no_speech_prob for p in parts), default=0.0), 3),
            })
            print(f"{d['clipId']} {s['id']}: {text}")
        drafts[d["clipId"]] = {"segments": segments}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "model": {
            "name": f"whisper-{args.model}",
            "version": f"faster-whisper {faster_whisper.__version__}, Systran/faster-whisper-{args.model}, int8, beam 5",
            "provenance": "Real model output produced offline by scripts/draft_with_whisper.py; not edited by hand.",
        },
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "drafts": drafts,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
