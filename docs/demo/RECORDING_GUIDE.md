# Reproduce and publish the demo

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
