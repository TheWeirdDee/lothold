"""Step 5 of demo production: cut the eight recorded scenes to the narration,
frame them for 1920x1080, add the end card, build timed captions, and render
lothold-demo.mp4 (H.264 + AAC, burned-in English captions).

Every frame in this render comes from real recordings of the deployed app
(docs/demo/raw/*.webm, recorded by scripts/demo-record.ts) or from the
generated end card. Nothing here fabricates an application state: segments are
only trimmed, held (freeze) or slowed down, never sped up to hide elapsed time
and never re-ordered to imply an action that did not happen.

Outputs:
  lothold-demo.mp4            - 1920x1080 H.264/AAC with burned captions
  docs/demo/CAPTIONS.srt      - the same captions as a standalone file
  docs/demo/endcard.png       - 1920x1080 closing card
  docs/demo/render-plan.json  - per-scene timing actually used
"""
import json
import subprocess
import sys
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

BIN = Path(sys.executable).parent / "Lib/site-packages/static_ffmpeg/bin/win32"
FFMPEG = os.environ.get("FFMPEG") or shutil.which("ffmpeg") or str(BIN / "ffmpeg.exe")
FFPROBE = os.environ.get("FFPROBE") or shutil.which("ffprobe") or str(BIN / "ffprobe.exe")

ROOT = Path(".")
RAW = ROOT / "docs/demo/raw"
AUDIO = ROOT / "docs/demo/audio"
DEMO = ROOT / "docs/demo"
WORK = DEMO / "build"
WORK.mkdir(parents=True, exist_ok=True)

LEAD = 0.4   # silence before each scene's speech
TAIL = 0.8   # silence after it
ENDCARD_SECONDS = 11.0
SLOW_MIN = 0.85   # slowest allowed playback for short footage (never faster than 1x)
FPS = 25
FONT_BURN = "Segoe UI,Fontsize=13,PrimaryColour=&H00FFFFFF,BackColour=&HA0000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=30,Alignment=2"

# Per-scene cut plan. Segments are [source, in_seconds, out_seconds].
# fit = which segment absorbs a small over-length (default: last).
PLAN = [
    {"scene": 1, "segments": [["scene-01-problem.webm", 3.0, 24.0],
                              ["scene-03-uploads.webm", 40.0, 46.64]], "fit": 0, "zoom": True},
    {"scene": 2, "segments": [["scene-02-introduce.webm", 0.6, 18.92]], "zoom": True},
    {"scene": 3, "segments": [["scene-03-uploads.webm", 4.0, 27.21]], "zoom": True},
    {"scene": 4, "segments": [["scene-04-analysis.webm", 2.5, 22.88]], "zoom": True},
    {"scene": 5, "segments": [["scene-05-findings-pdf.webm", 2.5, 26.38]], "zoom": True},
    {"scene": 6, "segments": [["scene-06-review.webm", 1.0, 26.03]], "zoom": True},
    {"scene": 7, "segments": [["scene-07-export.webm", 7.0, 14.2],
                              ["scene-07-export.webm", 14.4, 20.3],
                              ["scene-07-export.webm", 20.5, 23.5],
                              ["scene-07-export.webm", 23.7, 30.5]], "fit": 3, "zoom": True},
    {"scene": 8, "segments": [["scene-08-closing.webm", 1.5, 14.32]], "zoom": False, "endcard": True},
]


def run(args: list[str]) -> None:
    proc = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        print("COMMAND FAILED:", " ".join(args[:12]), file=sys.stderr)
        print(proc.stderr[-6000:], file=sys.stderr)
        raise SystemExit(1)


def duration(path: str) -> float:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, encoding="utf-8")
    return float(out.stdout.strip())


def make_endcard() -> Path:
    from PIL import Image, ImageDraw, ImageFont
    path = DEMO / "endcard.png"
    W, H = 1920, 1080
    img = Image.new("RGB", (W, H), (18, 20, 19))
    d = ImageDraw.Draw(img)
    cream = (244, 243, 236)
    muted = (176, 178, 172)
    green = (86, 166, 110)
    try:
        f_title = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 150)
        f_tag = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 46)
        f_lab = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 30)
        f_url = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 40)
        f_note = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 26)
    except OSError:
        f_title = f_tag = f_lab = f_url = f_note = ImageFont.load_default()

    d.text((W // 2, 300), "LotHold", font=f_title, fill=cream, anchor="mm")
    d.rectangle([W // 2 - 60, 400, W // 2 + 60, 406], fill=green)
    d.text((W // 2, 470), "From scattered shipment records to reviewable land evidence.",
           font=f_tag, fill=muted, anchor="mm")
    d.text((W // 2, 620), "LIVE APPLICATION", font=f_lab, fill=green, anchor="mm")
    d.text((W // 2, 675), "https://lothold.vercel.app/", font=f_url, fill=cream, anchor="mm")
    d.text((W // 2, 775), "SOURCE CODE", font=f_lab, fill=green, anchor="mm")
    d.text((W // 2, 830), "https://github.com/TheWeirdDee/lothold", font=f_url, fill=cream, anchor="mm")
    d.text((W // 2, 950), "All records shown are labelled engineering test data, not a real cocoa shipment.",
           font=f_note, fill=muted, anchor="mm")
    img.save(path)
    return path


def build_scene(plan: dict, audio_seconds: float) -> tuple[Path, dict]:
    """Render one scene's video (no audio) at exactly audio_seconds."""
    n = plan["scene"]
    segs = [list(s) for s in plan["segments"]]
    target = audio_seconds
    endcard_note = None
    if plan.get("endcard"):
        target = round(audio_seconds - ENDCARD_SECONDS, 3)
        endcard_note = f"footage {target}s + end card {ENDCARD_SECONDS}s"

    total = sum(s[2] - s[1] for s in segs)
    stretch = 1.0
    freeze = 0.0
    if total > target + 0.01:                      # trim the designated segment
        idx = plan.get("fit", len(segs) - 1)
        segs[idx][2] = round(segs[idx][2] - (total - target), 3)
        total = sum(s[2] - s[1] for s in segs)
    elif total < target - 0.01:                    # slow down, then hold the last frame
        stretched = min(target, total / SLOW_MIN)
        stretch = stretched / total
        freeze = round(target - stretched, 3)
        total = stretched

    # filter chain: segments -> slowdown -> zoom -> frame -> overlay -> freeze
    inputs, labels = [], []
    for i, (src, tin, tout) in enumerate(segs):
        inputs += ["-i", str(RAW / src)]
        labels.append(f"[{i}:v]trim=start={tin}:end={tout},setpts=PTS-STARTPTS[v{i}]")
    joined = "".join(f"[v{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=0[c{n}]"
    graph = ";".join(labels + [joined])
    cur = f"[c{n}]"
    if abs(stretch - 1.0) > 1e-3:
        # stretch >= 1 lengthens the clip (slower playback), never speeds it up
        graph += f";{cur}setpts=PTS*{stretch:.6f}[s{n}]"
        cur = f"[s{n}]"

    footage_len = total
    if plan.get("zoom"):
        # subtle push-in and back-out over the whole scene, centered on the UI
        t = "(n/25)"
        ramp = f"min({t}/1.5\\,1)*min(({footage_len:.3f}-{t})/1.5\\,1)"
        z = f"(1+0.06*{ramp})"
        graph += (f";{cur}crop=w='iw/{z}':h='ih/{z}':x='(iw-ow)/2':y='(ih-oh)/2'[z{n}]")
        cur = f"[z{n}]"

    # framing: sharp 16:10 foreground over a blurred, darkened copy of itself
    graph += (f";{cur}scale=1728:1080,setsar=1,split=2[fg{n}][bgsrc{n}]"
              f";[bgsrc{n}]scale=1920:1080:force_original_aspect_ratio=increase,"
              f"crop=1920:1080,boxblur=22:5,eq=brightness=-0.16:saturation=0.7[bg{n}]"
              f";[bg{n}][fg{n}]overlay=x=96:y=0[pre{n}]")
    final = f"[pre{n}]"
    if n == 2:
        # Privacy mask only: preserve the real registration action and organisation.
        # Covers email and password across the subtle zoom, before the real navigation.
        graph += (f";{final}drawbox=x=1100:y=575:w=650:h=240:color=0x171b19:t=fill:enable='lt(t,8.6)',"
                  "drawtext=fontfile='C\\:/Windows/Fonts/segoeui.ttf':text='Account details hidden':"
                  "fontcolor=white:fontsize=25:x=1140:y=670:enable='lt(t,8.6)'[privacy2]")
        final = "[privacy2]"
    if freeze > 0.02:
        graph += f";{final}tpad=stop_duration={freeze}:stop_mode=clone[fr{n}]"
        final = f"[fr{n}]"
    graph += f";{final}format=yuv420p,fps={FPS},setsar=1[out{n}]"

    out = WORK / f"scene-{n:02d}.mp4"
    run([FFMPEG, "-y", "-v", "error", *inputs,
         "-filter_complex", graph, "-map", f"[out{n}]",
         "-t", f"{target:.3f}", "-r", str(FPS),
         "-c:v", "libx264", "-preset", "medium", "-crf", "17",
         "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.0",
         str(out)])

    info = {
        "scene": n,
        "rawSegments": [{"source": s[0], "in": s[1], "out": s[2]} for s in segs],
        "sourceSeconds": round(sum(s[2] - s[1] for s in segs), 3),
        "playbackSpeed": round(1 / stretch, 4),
        "freezeHoldSeconds": freeze,
        "durationSeconds": duration(str(out)),
        "targetSeconds": audio_seconds,
        "footageTargetSeconds": target,
        "endCard": endcard_note,
        "zoom": bool(plan.get("zoom")),
    }
    return out, info


def build_endcard_clip() -> Path:
    out = WORK / "scene-08b-endcard.mp4"
    png = make_endcard()
    run([FFMPEG, "-y", "-v", "error", "-loop", "1", "-framerate", str(FPS),
         "-t", f"{ENDCARD_SECONDS:.3f}", "-i", str(png),
         "-vf", "format=yuv420p,setsar=1",
         "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "17",
         "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.0",
         str(out)])
    return out


def build_audio(plan_infos: list[dict]) -> Path:
    """Lead silence + narration + tail padding, exactly matching each scene video."""
    wavs = []
    for info in plan_infos:
        n = info["scene"]
        mp3 = AUDIO / f"scene-{n:02d}.mp3"
        wav = WORK / f"scene-{n:02d}.wav"
        run([FFMPEG, "-y", "-v", "error", "-i", str(mp3),
             "-af", f"adelay={int(LEAD*1000)}:all=1,apad=whole_dur={info['targetSeconds']:.3f}",
             "-ar", "48000", "-ac", "2", str(wav)])
        wavs.append(wav)
    inputs = []
    for w in wavs:
        inputs += ["-i", str(w)]
    chain = "".join(f"[{i}:a]" for i in range(len(wavs))) + f"concat=n={len(wavs)}:v=0:a=1[cat]"
    # broadcast-style loudness, single pass
    graph = chain + ";[cat]loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
    out = WORK / "narration.m4a"
    run([FFMPEG, "-y", "-v", "error", *inputs, "-filter_complex", graph,
         "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
         str(out)])
    return out


def _align_tokens(narration: str, scene_words: list[dict]) -> list[str] | None:
    """Map edge-tts word boundaries back onto the original narration tokens so
    captions keep the script's punctuation. Returns None when alignment fails,
    in which case the caption falls back to the engine's plain words."""
    tokens = narration.split()
    def norm(s: str) -> str:
        return "".join(ch for ch in s.lower() if ch.isalnum())
    if len(tokens) != len(scene_words):
        return None
    if [norm(t) for t in tokens] != [norm(w["word"]) for w in scene_words]:
        return None
    return tokens


def build_captions(plan_infos: list[dict]) -> Path:
    """SRT timed from edge-tts WordBoundary events, offset by each scene's start."""
    words = json.loads((AUDIO / "words.json").read_text(encoding="utf-8"))
    srt_path = DEMO / "CAPTIONS.srt"
    cues = []
    offset = 0.0
    for info in plan_infos:
        n = info["scene"]
        scene_words = next(s for s in words["scenes"] if s["scene"] == n)["words"]
        display = _align_tokens(words["narration"][str(n)], scene_words) \
            or [w["word"] for w in scene_words]
        group, group_start = [], None
        def flush(end_t: float):
            nonlocal group, group_start
            if group:
                text = " ".join(group)
                cues.append((offset + LEAD + group_start, offset + LEAD + end_t, text.strip()))
            group, group_start = [], None
        prev_end = None
        for i, w in enumerate(scene_words):
            joined = " ".join(group + [display[i]]) if group else display[i]
            sentence_break = bool(group) and group[-1].endswith((".", "!", "?")) and len(" ".join(group)) >= 18
            if group and (w["start"] - prev_end > 0.75 or len(joined) > 46 or sentence_break):
                flush(prev_end + 0.12)
            if not group:
                group_start = w["start"]
            group.append(display[i])
            prev_end = w["end"]
        flush((prev_end or 0) + 0.35)
        offset += info["targetSeconds"]

    def ts(t: float) -> str:
        h, r = divmod(t, 3600)
        m, s = divmod(r, 60)
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int((s % 1) * 1000):03d}"

    # never let a cue run into the next one
    clipped = []
    for i, (a, b, text) in enumerate(cues):
        b = min(b, cues[i + 1][0] - 0.02) if i + 1 < len(cues) else b
        if b - a >= 0.2:
            clipped.append((a, b, text))

    lines = []
    for i, (a, b, text) in enumerate(clipped, 1):
        lines += [str(i), f"{ts(a)} --> {ts(b)}", text, ""]
    srt_path.write_text("\n".join(lines), encoding="utf-8")
    return srt_path


def final_render(scene_files: list[Path], audio: Path, srt: Path) -> Path:
    lst = WORK / "concat.txt"
    lst.write_text("".join(f"file '{Path(f).resolve().as_posix()}'\n" for f in scene_files), encoding="utf-8")
    total = sum(duration(str(f)) for f in scene_files)
    out = ROOT / "lothold-demo.mp4"
    srt_arg = str(srt).replace("\\", "/").replace(":", "\\:")
    run([FFMPEG, "-y", "-v", "error",
         "-f", "concat", "-safe", "0", "-i", str(lst),
         "-i", str(audio),
         "-vf", f"subtitles='{srt_arg}':force_style='{FONT_BURN}',"
                f"fade=t=in:st=0:d=0.5,fade=t=out:st={max(0.0, total - 1.2):.2f}:d=1.0",
         "-map", "0:v", "-map", "1:a",
         "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.0",
         "-c:a", "copy", "-movflags", "+faststart", "-shortest",
         str(out)])
    return out


def main() -> None:
    timeline = json.loads((RAW / "timeline.json").read_text(encoding="utf-8"))
    if len(timeline["scenes"]) != 8 or any(s.get("error") for s in timeline["scenes"]):
        raise SystemExit("Inspect failed/missing recorded scenes before adapting the edit; do not render an implied successful workflow.")
    for f in ["scene-01-problem.webm", "scene-08-closing.webm"]:
        if not (RAW / f).exists():
            raise SystemExit(f"missing raw footage {f}; run scripts/demo-record.ts first")
    if not (AUDIO / "words.json").exists():
        raise SystemExit("missing narration; run scripts/demo-narration.py first")

    infos, files = [], []
    for plan in PLAN:
        n = plan["scene"]
        audio_seconds = duration(str(AUDIO / f"scene-{n:02d}.mp3"))
        video, info = build_scene(plan, round(LEAD + audio_seconds + TAIL, 3))
        info["narrationSeconds"] = round(audio_seconds, 3)
        infos.append(info)
        files.append(video)
        if plan.get("endcard"):
            clip = build_endcard_clip()
            files.append(clip)
            info["endCard"] = f"footage {info['durationSeconds']:.1f}s + end card {ENDCARD_SECONDS}s"
        print(json.dumps(info))

    audio = build_audio(infos)
    srt = build_captions(infos)
    out = final_render(files, audio, srt)

    plan_out = {
        "renderedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Recordings of https://lothold.vercel.app in the isolated ENGINEERING TEST - DEMO workspace",
        "rawFootage": str(RAW),
        "leadSeconds": LEAD, "tailSeconds": TAIL, "endCardSeconds": ENDCARD_SECONDS,
        "scenes": infos,
        "totalVideoSeconds": duration(str(out)),
        "output": str(out),
        "resolution": "1920x1080", "codec": "H.264 (High) + AAC-LC", "fps": FPS,
        "captions": str(srt), "burnedIn": True,
    }
    (DEMO / "render-plan.json").write_text(json.dumps(plan_out, indent=2) + "\n", encoding="utf-8")
    print(f"rendered {out} in {plan_out['totalVideoSeconds']:.2f}s")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "finalize":
        # Rebuild captions and the final mux from already-rendered scene files.
        infos = json.loads((DEMO / "render-plan.json").read_text(encoding="utf-8"))["scenes"]
        srt = build_captions(infos)
        files = [WORK / f"scene-{p['scene']:02d}.mp4" for p in PLAN]
        for p in PLAN:
            if p.get("endcard"):
                files.append(WORK / "scene-08b-endcard.mp4")
        out = final_render(files, WORK / "narration.m4a", srt)
        print(f"finalized {out} ({duration(str(out)):.2f}s)")
    elif len(sys.argv) > 1 and sys.argv[1] == "privacy":
        info_path = DEMO / "render-plan.json"
        metadata = json.loads(info_path.read_text(encoding="utf-8"))
        old = next(i for i in metadata["scenes"] if i["scene"] == 2)
        build_scene(PLAN[1], old["targetSeconds"])
        srt = build_captions(metadata["scenes"])
        files = [WORK / f"scene-{p['scene']:02d}.mp4" for p in PLAN]
        files.append(WORK / "scene-08b-endcard.mp4")
        out = final_render(files, WORK / "narration.m4a", srt)
        metadata["renderedAt"] = datetime.now(timezone.utc).isoformat()
        metadata["privacyMask"] = "Registration email/password area hidden; no application results modified"
        metadata["totalVideoSeconds"] = duration(str(out))
        info_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        print(f"privacy render complete ({duration(str(out)):.2f}s)")
    else:
        main()
