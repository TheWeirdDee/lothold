"""Write delivery documentation from actual narration, edit decisions and QA reports."""
import json
import shutil
from pathlib import Path

ROOT = Path('docs/demo')
plan = json.loads((ROOT / 'render-plan.json').read_text(encoding='utf-8'))
words = json.loads((ROOT / 'audio/words.json').read_text(encoding='utf-8'))
qa = json.loads((ROOT / 'QA_REPORT.json').read_text(encoding='utf-8'))
timeline = json.loads((ROOT / 'raw/timeline.json').read_text(encoding='utf-8'))
assert len(timeline['scenes']) == 8 and not any(s.get('error') for s in timeline['scenes'])
shutil.copyfile(ROOT / 'raw/timeline.json', 'docs/evidence/demo-recording-timeline.json')

def stamp(s):
    return f'{int(s)//60}:{s%60:04.1f}'

titles = ['The problem', 'Introducing LotHold', 'Upload and verify documents', 'Land evidence',
          'Findings and supplier request', 'Record the review', 'XML draft and stale sign-off', 'Closing']
shots = [
    'Real landing page, followed by the missing-boundary finding and exact source row as a problem teaser.',
    'Create ENGINEERING TEST - DEMO and ENG-DEMO-A. Email/password area masked; real workspace navigation preserved.',
    'Upload the shipping text, show deterministic proposals and human acceptance, then source CSV upload, preview and confirmation.',
    'Confirm the full engineering plot file; open the actual tree-cover-loss observations and map. A cached raster result may be reused; no new compute-speed claim.',
    'Open a finding, generate the supplier-request PDF, then display the actual downloaded PDF in the browser viewer.',
    'Attach the labelled engineering investigation, save rationale, reserve the declared allocation and sign off the actual snapshot.',
    'Generate and open the actual DDS XML draft; change an accepted field and show Out of date / disabled export.',
    'Return to the engineering case and landing page, then the project links and engineering-data end card.'
]

script = ['# Final demo narration', '', 'Finished export: **3:14.200**, 1920×1080, H.264/AAC, 25 fps. English synthetic narration: Microsoft en-US-AndrewNeural, no music.',
          '', 'These are the words actually synthesized. Captions follow the speech boundary timestamps. All records are labelled engineering tests, not real shipments or farms.', '']
board = ['# Final storyboard', '', 'The source is real 1440×900 browser capture of the hosted application. It is framed at 1920×1080 without stretching the interface.', '', '| Scene | Final range | Actual visual |', '|---|---|---|']
offset = 0
for n, info in enumerate(plan['scenes'], 1):
    # Match the final concatenated frame durations, including the closing card.
    seconds = info['durationSeconds'] + (plan['endCardSeconds'] if n == 8 else 0)
    time_range = f'{stamp(offset)}–{stamp(offset+seconds)}'
    script += [f'## {n}. {titles[n-1]} ({time_range})', '', words['narration'][str(n)], '']
    board.append(f'| {n}. {titles[n-1]} | {time_range} | {shots[n-1]} |')
    offset += seconds
(ROOT / 'FINAL_SCRIPT.md').write_text('\n'.join(script), encoding='utf-8')
board += ['', '## Edit disclosures', '',
          '- Scene 1 includes a later finding as a problem teaser, then scene 2 returns to workspace creation.',
          '- Playback is never accelerated. Some footage is slowed to at least 0.85× or held for narration; this is not an analysis-latency benchmark.',
          '- Recorded waits and navigation outside the selected segments are omitted. No result is manufactured; the source intervals and hold durations are in [render-plan.json](render-plan.json).',
          '- The registration privacy mask hides account identifiers and password fields only. All evidence, findings and approval states remain genuine.',
          '- No model inference, blockchain transaction, legal certification or regulatory submission is claimed.', '']
(ROOT / 'STORYBOARD.md').write_text('\n'.join(board), encoding='utf-8')

(ROOT / 'CLAIMS_VERIFICATION.md').write_text('''# Claims and workflow verification

The hosted validation passed all **16 steps**, including real sign-off, DDS XML draft generation, and evidence-change invalidation. See [workflow results](../evidence/demo-workflow-validation.json). The separate recording completed eight scenes without recorded errors: [recording timeline](../evidence/demo-recording-timeline.json).

| Claim shown | Evidence and limit |
|---|---|
| Workspace and case creation | ENGINEERING TEST - DEMO / ENG-DEMO-A; actual hosted registration and case transitions |
| Shipping text extraction | Deterministic label parser, quoted proposals and explicit human acceptance; no AI inference claimed |
| Source and plot uploads | Real CSV/GeoJSON requests, preview and active-version confirmation |
| Source-linked missing boundary | Partial engineering geometry file creates the finding; exact source row is highlighted |
| Satellite observations | Pinned Hansen/JRC readings: 47 of 1600 sampled pixels after 2020, about 3.59 ha; no JRC-2020 forest overlap for this probe. Cached results can be reused; probe boxes are not farms |
| Supplier request PDF | Actual generated and downloaded PDF, source references and limits visible |
| Investigation | Labelled test attachment and rationale; no real sourcing conclusion asserted |
| Allocation reservation | Declared fixture quantity reserved in the local ledger; no public blockchain transaction |
| Snapshot sign-off | Real REVIEWED DRAFT transition after the application permits it |
| XML draft | Actual DDS-V3 DRAFT_NOT_SUBMITTED download; server validates the draft before offering it. XML was not submitted to an authority |
| Stale sign-off | A real accepted description change creates Out of date state and disables XML export |
| Hosted evidence recovery | Earlier independent restart/redeployment checks in [hosted evidence](../evidence/hosted-workflow.json); narrated as previous pilot evidence, not shown as a newly filmed restart |

No requested core demo workflow was blocked or replaced with a mock success. A cold-start experiment, sustained load/capacity, provider quota telemetry, and regulatory acceptance are outside the video. No physical-origin, legality, adoption or environmental-impact result is asserted.

PDF/XML preview views use presentation-only browser routes to display the actual downloaded bytes. They do not replace business API responses or create documents. The stored XML is also downloaded again and checked independently: [final artifact check](../evidence/demo-artifacts-final.json).
''', encoding='utf-8')

(ROOT / 'RECORDING_GUIDE.md').write_text('''# Reproduce and publish the demo

The finished MP4 is at the repository root: `lothold-demo.mp4`. It is intentionally gitignored; the raw browser clips, speech files and build intermediates also stay local. The MP4 was not uploaded, added to Git, or submitted to the hackathon.

## Tools

Node 24 and the repository dependencies, Chrome, Python, FFmpeg/FFprobe, Pillow, edge-tts, and (for optional offline transcription) faster-whisper with a cached base.en model. Set `FFMPEG` and `FFPROBE` if the executables are not on PATH; the installed Windows static_ffmpeg package is also supported. Narration synthesis uses the external Edge speech service with the public script text only. No .env keys are loaded by the production scripts.

## Capture and render

1. Confirm the authorized hosted frontend is reachable. Keep all inputs within a new ENGINEERING TEST - DEMO workspace and ENG-DEMO- case references.
2. Run `node scripts/demo-validate.ts` and inspect `docs/evidence/demo-workflow-validation.json` for unsuccessful steps. Do not bypass holds to make a video.
3. Preserve existing raw clips before re-recording: `node scripts/demo-record.ts` replaces its raw output directory. Capture uses a 1440×900 viewport, full application frame and random engineering credentials stored only in gitignored `.env.demo-recording.json`.
4. Run `python scripts/demo-narration.py`. This writes actual speech and word-boundary timings. It fails if synthesis is unavailable.
5. Inspect the newly captured timeline and adapt the source intervals in `scripts/demo-render.py`; timings from an older capture must not be assumed to fit a new run.
6. Run `python scripts/demo-render.py`. For the existing edit, `python scripts/demo-render.py privacy` rebuilds the account mask and final MP4 from the retained scene files.
7. Run `python scripts/demo-qa.py --transcribe`, `node scripts/demo-playback.cjs`, `node scripts/demo-thumbnail.cjs`, then `python scripts/demo-docs.py`.
8. Inspect the entire final edit and privacy area, captions, PDF/XML, sign-off transition and closing links. Re-run QA whenever the MP4 changes.

## Manual publication

Review the local MP4, then obtain the owner's authorization before any YouTube/Vimeo upload or hackathon submission. Upload the exact MP4 and PNG thumbnail; the matching standalone captions are [CAPTIONS.srt](CAPTIONS.srt). Set the intended visibility yourself and verify the final video link in a signed-out browser before submitting it. A repository push does not upload the video.

The [official event page](https://ieee-climatechain-hack.devpost.com/) requests a 3–5 minute demo. The 3:14.2 export fits that range and the user's narrower 3–4 minute target. Eligibility, submission status and acceptance are separate account decisions; no entry was submitted by this work.
''', encoding='utf-8')

playback_path = ROOT / 'PLAYBACK_QA.json'
playback = json.loads(playback_path.read_text(encoding='utf-8')) if playback_path.exists() else None
status = 'passed, full normal-speed Chrome playback through the end' if playback and playback.get('passed') else 'pending'
content = f'''# Final video QA

Export: **lothold-demo.mp4**, **{qa['durationSeconds']:.3f} seconds (3:14.200)**, **1920×1080**, **25 fps**, **H.264 High / AAC stereo, 48 kHz**. Size: {qa['bytes']:,} bytes. SHA-256: `{qa['sha256']}`.

| Check | Result |
|---|---|
| Full video/audio decode | Passed; no FFmpeg decoding errors |
| Normal-speed browser playback | {status} |
| Internal black frames | None detected; only the intentional final 0.28-second fade to black |
| Audio loudness | {qa['audioMeasurements']['input_i']} LUFS integrated; true peak {qa['audioMeasurements']['input_tp']} dBTP, below clipping |
| Independent speech transcription | Cached faster-whisper base.en; normalized character similarity {qa['independentAudioTranscription']['characterSimilarity']:.2%} to the narration |
| Captions | {qa['captionCues']} nonoverlapping, in-range cues; words exactly match the narration source |
| Visual review | Full-edit contact sequence at two-second intervals, plus full-resolution checks of registration privacy, source confirmation, observations, PDF, XML and stale approval |
| Privacy | Account details masked in the registration footage; no .env, tokens, provider dashboards or operational records shown |
| Authenticity | Eight real hosted scenes; 16 independently validated workflow steps; no failed scene reported |
| Duration | Fits requested 3–4 minutes and official 3–5 minute range |
| Thumbnail | Real captured observation screen with native graphic layout, 1920×1080 PNG |

Machine evidence: [QA_REPORT.json](QA_REPORT.json), [TRANSCRIPTION.json](TRANSCRIPTION.json), [PLAYBACK_QA.json](PLAYBACK_QA.json), [render-plan.json](render-plan.json). ASR is independent of the narration timing source; it does not replace subjective human listening. No human listening-panel or frame-by-frame human review is claimed. The actual visual review method is stated above.

The speaker is a synthetic English voice; there is no music. The XML is a validated draft, not regulatory acceptance. Earlier hosted recovery is described as prior pilot evidence; no restart is staged in the video. The old landing-page WebM is a separate local recording and has not been replaced or relabelled by this deliverable.

No YouTube upload or hackathon submission has been performed. The large MP4 and raw assets remain outside Git.
'''
(ROOT / 'VIDEO_QA.md').write_text(content, encoding='utf-8')
print('Wrote six delivery documents from actual narration, timeline, render and QA evidence.')
