# Free deployment validation ? 2026-10-25

No hosted project exists yet. No push, deployment, paid service or operational-data migration was performed.

## Passed locally

- TypeScript check.
- 114 unit/integration tests, including four checkpoint tests using real SQLite/encryption and a remote protocol double.
- 20 browser checks in the full suite. The remaining cold-start check passed separately after fixing a missed initial-mount startup event. No claim of a single clean 21-test run.
- Autoplay/loop, deliberate pause, bundled video playback, reduced motion, accessibility, keyboard navigation, isolated-browser login and workflow checks.
- Responsive sweep: 16 pages/tabs across ten widths (320?1920 px), zero flagged combinations. Machine report and visually reviewed registry images are in `docs/screenshots/responsive-final/`.

## Constrained local Docker result

The proof overlay completed all 16 checks with a 512 MiB hard memory limit, no swap, and 0.1 CPU. Real raster analysis, PDF generation/download and byte-identical evidence decryption passed. Peak cgroup memory was 288,546,816 bytes (about 275 MiB); OOM and OOM-kill counters were zero. The forest job took 89,794 ms; PDF generation took 18,201 ms. Startup readiness took roughly 324 seconds. The peak includes the verification process sharing the container budget.

This proves one representative sequential local workflow fits memory; it does not prove hosted concurrency, remote persistence, remote checkpoint latency, or acceptable browser responsiveness under load. The proof overlay reused the earlier verified raster image and copied current backend sources. Its inherited frontend is not the final production build. Raw engineering logs are committed for inspection; they contain no credentials. See `docs/evidence/free-resource-workflow.jsonl`, `free-resource-memory.txt`, `free-resource-container.json`, and `free-resource-server.log`.

## Still required before calling this judge-ready

- Live Supabase SQL execution, private object API and RPC verification.
- Hosted account/evidence recovery after both restart and filesystem-replacing redeployment.
- Final production Dockerfile build, provider image admission, hosted resource and latency measurements.
- Hosted browser responsiveness during the roughly 90-second raster job: ordinary API timeouts may expire under this CPU budget.
- Free quota/egress monitoring. Whole-database checkpoint uploads are bounded but bandwidth-heavy.
- Cold-start performance acceptance: the local 0.1 CPU proof first served readiness roughly 5 minutes 24 seconds after container creation. This exceeds the frontend's four-minute automatic polling window; its explicit retry remains available. Do not advertise one-minute cold recovery. Investigate server import/startup cost or evaluate another genuinely free compute option before committing to judging reliability.

See `FREE_HOSTING_SETUP.md` for the exact manual setup and acceptance steps. Cloud secrets must remain server-only and unchanged across redeployments.
