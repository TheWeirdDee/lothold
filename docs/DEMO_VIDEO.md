# Recorded product walkthrough

The landing page now uses recordings of the actual application, bundled with the frontend:

- `web/public/media/lothold-full.webm`: full real-interaction engineering journey.
- `web/public/media/lothold-short.webm`: short muted review preview.
- `web/public/media/lothold-poster.jpg`: real application poster capture.
- `web/public/media/lothold.en.vtt`: timed English captions.
- A readable transcript is included in the landing page itself.

No video settings API or external embed is needed. The short preview and full recording use `preload="none"`; the muted short preview starts automatically when visible and loops continuously. The full recording starts through an explicit user action. Preview motion has a visible pause control, pauses offscreen, and never starts automatically under reduced motion or data-saving preferences. A deliberate pause stays paused. The full player exposes native playback and fullscreen controls. The public media can be served by a static host while account/work routes remain unavailable.

## What was recorded

A separate engineering server, temporary SQLite database, new random encryption/signing keys, and explicitly labelled engineering records. The recording performs registration and case creation, document upload, deterministic field extraction and acceptance, CSV/GeoJSON upload-preview-confirm, a missing-boundary source link, real pinned raster inspection, supplier PDF generation/opening, an evidence-backed engineering investigation, ledger reservation, sign-off, XML draft export, and evidence changes that make sign-off/documents stale.

The probe boxes are not farms. Quantities and evidence files are invented and do not establish any real sourcing or land-use conclusion. The raster observations are genuine readings of the installed pinned tiles. No public blockchain transaction, physical shipment or official regulatory submission is performed.

## Reproduce

With dependencies and verified raster snapshots already installed:

```sh
npm run build
npm run record:walkthrough
npm run build
npm run test:e2e
```

The recorder starts and stops its own engineering backend on port 8804. It never loads `.env`, changes the operational database, or uses operational accounts. It also tests login from a separate browser context, restart with the same temporary database/keys, byte-identical evidence decryption/download, and logout. Results and chapter timing are written to `docs/evidence/experience-recording.json`; passwords and key material are not written there.

`RECORD_FAST` is a developer-only debugging switch and must be unset for the final deliberately paced recording. Captions use actual chapter timestamps from the run. Rebuild after recording so static hosts receive the new media.

Legacy `DEMO_VIDEO_*` environment configuration and its API remain for compatibility, but the landing page does not request or depend on them. To change the public walkthrough, replace/re-record the bundled assets and verify playback.
