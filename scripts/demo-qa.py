"""Independently decode and measure the final demo; optionally transcribe its audio offline.
No credentials or cloud services are used. Run after demo-render.py completes.
"""
import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from demo_render_tools import executable


def run(args):
    p = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode:
        raise RuntimeError(p.stderr[-2000:])
    return p


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcribe", action="store_true")
    args = parser.parse_args()
    root = Path("docs/demo")
    work = root / "qa"
    work.mkdir(exist_ok=True)
    video = Path("lothold-demo.mp4")
    ffmpeg, probe = executable("ffmpeg"), executable("ffprobe")
    media = json.loads(run([probe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)]).stdout)
    duration = float(media["format"]["duration"])
    v = next(x for x in media["streams"] if x["codec_type"] == "video")
    a = next(x for x in media["streams"] if x["codec_type"] == "audio")
    decoded = run([ffmpeg, "-v", "error", "-i", str(video), "-f", "null", "-"])
    analysis = run([ffmpeg, "-hide_banner", "-i", str(video), "-vf", "blackdetect=d=0.2:pix_th=0.1:pic_th=0.98",
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]).stderr
    (work / "signal-analysis.txt").write_text(analysis, encoding="utf-8")
    loudness = json.loads(re.findall(r'\{\s*"input_i".*?\}', analysis, re.S)[-1])
    blacks = [{"start": float(s), "end": float(e), "seconds": float(d)} for s, e, d in
              re.findall(r"black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)", analysis)]
    cues = re.findall(r"(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})\n([^\n]+)", (root / "CAPTIONS.srt").read_text(encoding="utf-8"))
    def seconds(x):
        h, m, s = x.replace(",", ".").split(":")
        return int(h) * 3600 + int(m) * 60 + float(s)
    previous = 0
    for start, end, _ in cues:
        assert previous <= seconds(start) < seconds(end) <= duration
        previous = seconds(end)
    words = json.loads((root / "audio/words.json").read_text(encoding="utf-8"))
    narration = " ".join(words["narration"][str(i)] for i in range(1, 9))
    normalize = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    assert normalize(" ".join(c[2] for c in cues)) == normalize(narration), "Caption words differ from narration"
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "video": str(video),
              "sha256": hashlib.sha256(video.read_bytes()).hexdigest(), "bytes": video.stat().st_size,
              "durationSeconds": duration, "videoCodec": v["codec_name"], "audioCodec": a["codec_name"],
              "width": v["width"], "height": v["height"], "fps": v["r_frame_rate"],
              "fullDecodeErrors": decoded.stderr.strip(), "blackIntervals": blacks,
              "audioMeasurements": loudness, "captionCues": len(cues), "captionsExactNarrationWords": True,
              "officialDurationRangeSeconds": [180, 300], "requestedDurationRangeSeconds": [180, 240],
              "rulesSource": "https://ieee-climatechain-hack.devpost.com/"}
    assert v["codec_name"] == "h264" and a["codec_name"] == "aac"
    assert (v["width"], v["height"]) == (1920, 1080) and 180 <= duration <= 240
    assert not decoded.stderr.strip()
    assert not any(b["start"] > 1 and b["end"] < duration - 1.5 for b in blacks), "Unexpected internal black interval"
    assert float(loudness["input_tp"]) < 0, "Audio clipping risk"
    if args.transcribe:
        from faster_whisper import WhisperModel
        # Local cache only; no download, API key, or paid transcription.
        model = WhisperModel("base.en", device="cpu", compute_type="int8", local_files_only=True, cpu_threads=2)
        import numpy as np
        pcm = subprocess.run([ffmpeg, "-v", "error", "-i", str(video), "-vn", "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"], capture_output=True, check=True).stdout
        segments, _ = model.transcribe(np.frombuffer(pcm, dtype=np.float32).copy(), language="en", beam_size=1, vad_filter=False)
        transcript = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]
        (root / "TRANSCRIPTION.json").write_text(json.dumps(transcript, indent=2) + "\n", encoding="utf-8")
        actual = " ".join(s["text"] for s in transcript)
        ratio = SequenceMatcher(None, normalize(narration), normalize(actual), autojunk=False).ratio()
        report["independentAudioTranscription"] = {"model": "cached faster-whisper base.en, CPU int8", "characterSimilarity": round(ratio, 4),
                                                   "transcript": "TRANSCRIPTION.json", "note": "ASR is a separate check; proper-name errors are inspected, not silently corrected."}
    report["automatedChecksPassed"] = True
    (root / "QA_REPORT.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
