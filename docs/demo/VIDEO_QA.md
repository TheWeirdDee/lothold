# Final video QA

Export: **lothold-demo.mp4**, **194.200 seconds (3:14.200)**, **1920×1080**, **25 fps**, **H.264 High / AAC stereo, 48 kHz**. Size: 14,065,000 bytes. SHA-256: `309ac647c70eb52ce626f040fb54fc418b159fa6cdc779d3e07d514cca65f251`.

| Check | Result |
|---|---|
| Full video/audio decode | Passed; no FFmpeg decoding errors |
| Normal-speed browser playback | passed, full normal-speed Chrome playback through the end |
| Internal black frames | None detected; only the intentional final 0.28-second fade to black |
| Audio loudness | -16.09 LUFS integrated; true peak -1.54 dBTP, below clipping |
| Independent speech transcription | Cached faster-whisper base.en; normalized character similarity 99.98% to the narration |
| Captions | 74 nonoverlapping, in-range cues; words exactly match the narration source |
| Visual review | Full-edit contact sequence at two-second intervals, plus full-resolution checks of registration privacy, source confirmation, observations, PDF, XML and stale approval |
| Privacy | Account details masked in the registration footage; no .env, tokens, provider dashboards or operational records shown |
| Authenticity | Eight real hosted scenes; 16 independently validated workflow steps; no failed scene reported |
| Duration | Fits requested 3–4 minutes and official 3–5 minute range |
| Thumbnail | Real captured observation screen with native graphic layout, 1920×1080 PNG |

Machine evidence: [QA_REPORT.json](QA_REPORT.json), [TRANSCRIPTION.json](TRANSCRIPTION.json), [PLAYBACK_QA.json](PLAYBACK_QA.json), [render-plan.json](render-plan.json). ASR is independent of the narration timing source; it does not replace subjective human listening. No human listening-panel or frame-by-frame human review is claimed. The actual visual review method is stated above.

The speaker is a synthetic English voice; there is no music. The XML is a validated draft, not regulatory acceptance. Earlier hosted recovery is described as prior pilot evidence; no restart is staged in the video. The old landing-page WebM is a separate local recording and has not been replaced or relabelled by this deliverable.

No YouTube upload or hackathon submission has been performed. The large MP4 and raw assets remain outside Git.
