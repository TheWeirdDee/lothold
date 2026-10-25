"""Step 4 of demo production: synthesize the eight-scene narration with edge-tts
(Microsoft neural voices, natural English) and capture WordBoundary events so the
caption file can be timed to the real speech instead of guessed.

Outputs:
  docs/demo/audio/scene-01.mp3 ... scene-08.mp3
  docs/demo/audio/words.json   - per-scene word timings in seconds from scene audio start

If the network TTS service is unreachable this script fails loudly; it never
fabricates audio.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import edge_tts

ATTEMPTS = 4

VOICE = os.environ.get("DEMO_VOICE", "en-US-AndrewNeural")
# Slightly slower than default: moderate pace, natural pauses, no ad tone.
RATE = os.environ.get("DEMO_RATE", "-6%")

OUT = Path("docs/demo/audio")
OUT.mkdir(parents=True, exist_ok=True)

NARRATION = {
    1: "Imagine you're importing cocoa from another country. Before you can confidently accept a shipment, you need to understand where that cocoa came from and whether the supporting land evidence is consistent. But that information can be spread across supplier spreadsheets, shipment documents, and satellite data. A shipment might look complete on paper while important details are missing or contradictory. That's the problem LotHold is built to help solve.",
    2: "LotHold brings those records together into one review workflow. It helps cocoa exporters and importers organize shipment evidence, identify inconsistencies, examine available satellite observations, and document their decisions. Let me show you how it works.",
    3: "First, I create a case for a shipment and upload the supplier records. LotHold reads the information and shows me exactly what it found. I can inspect the quantities, land references, and source files before accepting them. This matters because uploading a document doesn't automatically mean its information is correct. The reviewer stays in control.",
    4: "Next, LotHold examines published satellite data for the supplied locations. Here, we can see observations about tree-cover loss, including the years associated with those observations. These results help identify areas that may need closer investigation. But satellite observations alone don't prove that a supplier broke a law or that a shipment is non-compliant. They're evidence for a human reviewer to consider.",
    5: "When LotHold finds a gap or a concern, it doesn't simply give the shipment a pass or fail. It shows the issue and links it back to the supporting information. The reviewer can then generate a request asking the supplier for the specific evidence needed. Instead of a vague request for more documents, the supplier gets a clearer explanation of what's missing.",
    6: "Once the evidence has been examined, the reviewer records what they checked, their reasoning, and any supporting documents. LotHold keeps that decision connected to the evidence used during the review. If important information changes afterward, the previous decision may need to be reviewed again. This is about making the process easier to inspect, not automatically certifying the shipment.",
    7: "LotHold also supports preparing structured due-diligence records. A due-diligence statement is a formal declaration supported by the information a business has reviewed. Any generated XML is a draft for further validation and submission through the appropriate official process. It is not proof of regulatory acceptance.",
    8: "What you've seen is a real LotHold engineering test workflow, using clearly labelled test records rather than an actual cocoa shipment. The hosted pilot has demonstrated uploads, satellite analysis, PDF generation, and evidence recovery. Our goal is simple: make cocoa supply-chain evidence easier to organize, investigate, and review. This is LotHold.",
}


async def synth(n: int, text: str) -> dict:
    """Synthesize one scene. The edge service intermittently returns no audio,
    so retry with backoff instead of ever writing placeholder silence."""
    last = ""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            comm = edge_tts.Communicate(text, VOICE, rate=RATE, boundary="WordBoundary")
            audio = bytearray()
            words = []
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    start = chunk["offset"] / 1e7  # 100ns ticks -> seconds
                    dur = chunk["duration"] / 1e7
                    words.append({"word": chunk["text"], "start": round(start, 3), "end": round(start + dur, 3)})
            if len(audio) < 1000:
                raise RuntimeError(f"no usable audio ({len(audio)} bytes)")
            path = OUT / f"scene-{n:02d}.mp3"
            path.write_bytes(bytes(audio))
            return {"scene": n, "file": str(path), "bytes": len(audio), "words": words}
        except Exception as exc:  # transient service errors are retried
            last = str(exc)
            print(f"scene {n}: attempt {attempt}/{ATTEMPTS} failed: {exc}")
            await asyncio.sleep(2 * attempt)
    raise RuntimeError(f"scene {n}: TTS failed after {ATTEMPTS} attempts: {last}")


async def main() -> None:
    results = []
    for n in sorted(NARRATION):
        r = await synth(n, NARRATION[n])
        results.append(r)
        print(f"scene {n}: {len(r['words'])} words, {r['bytes']} bytes")
    (OUT / "words.json").write_text(json.dumps(
        {"voice": VOICE, "rate": RATE, "narration": NARRATION, "scenes": results}, indent=2) + "\n")
    print("wrote", OUT / "words.json")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:  # report TTS limitation honestly instead of faking audio
        print(f"NARRATION FAILED: {exc}", file=sys.stderr)
        sys.exit(1)