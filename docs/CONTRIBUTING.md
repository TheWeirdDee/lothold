# Contributing and documentation maintenance

This repository is maintained so that documentation and code change together. Treat a documentation update as part of the change that makes it necessary, in the same work cycle — not as a follow-up task.

## Documentation-maintenance checklist

Run through this whenever a change touches one of these areas. Each row says what must be updated in the same commit series.

| When this changes… | Update… |
|---|---|
| An environment variable is added, renamed or changes meaning | The [configuration tables](../README.md#configuration), `.env.example`, and any deployment doc that lists runtime settings ([DEPLOYMENT.md](DEPLOYMENT.md), [RENDER_PUBLISH_HANDOFF.md](RENDER_PUBLISH_HANDOFF.md), [FREE_HOSTING_SETUP.md](FREE_HOSTING_SETUP.md)) |
| A command is added, renamed or changes behaviour | [README quick start](../README.md#quick-start) and [testing](../README.md#testing-and-reproducibility), `package.json` scripts, and the affected doc's instructions |
| Hosting or deployment state changes (something goes live, or stops) | [README status table](../README.md#current-status), [DEPLOYMENT.md](DEPLOYMENT.md), and the evidence file recording the check. Availability claims require a dated check |
| AI verification succeeds or fails | [README status table](../README.md#current-status), [AI.md](AI.md) status block, and `docs/evidence/ai-live-verification.json` (written by the script) |
| Datasets, coverage, versions or licences change | [README environmental method](../README.md#environmental-method), [METHOD.md](METHOD.md), [SOURCES.md](SOURCES.md), `scripts/fetch-datasets.ts` pins, and the provisioning instructions |
| A UI label, tab name or workflow step changes | [README walkthrough](../README.md#a-short-walkthrough), screenshots in `docs/screenshots/`, and the recording/shot list ([DEMO_VIDEO.md](DEMO_VIDEO.md), [DEMO_SCRIPT_AND_SHOTS.md](DEMO_SCRIPT_AND_SHOTS.md)) |
| The contract, network or addresses change | [README registry section](../README.md#blockchain-the-allocation-registry), [CHAIN.md](CHAIN.md), the evidence JSON files, and `.env.example` |
| Test counts or suites change | [README status/testing tables](../README.md#testing-and-reproducibility), [VERIFICATION.md](VERIFICATION.md), [EVIDENCE.md](EVIDENCE.md) — quote the dated run, never a remembered number |
| A recording/video is replaced | The linked thumbnail, direct media links and captions in the README and [DEMO_VIDEO.md](DEMO_VIDEO.md) |
| A file is renamed or moved | Every link to it — `npm run docs:check` fails the build if one is missed |

## Source of truth

Avoid competing status pages. The single source for "what works, and how do I know":

- **`README.md` — Current status table** for product-level availability and verification.
- **`docs/evidence/*.json`** for machine-generated results; docs link to them rather than restating numbers.
- **`docs/VERIFICATION.md`** for the narrative verification record (commands, scope, defects found and fixed).
- **`docs/EVIDENCE.md`** for what each class of evidence can and cannot support.

Anything else that states status must link to one of these instead of restating it.

## Automated checks

```bash
npm run docs:check   # every relative link and image in the Markdown resolves to a real file
npm run verify       # docs links → dataset hashes → typecheck → unit/integration → contracts → browser
```

`tests/unit/doc-links.test.ts` runs the same link check as part of `npm test`. The check asserts only that local targets exist — it never asserts prose wording, so it will not break on honest rewording. Please keep it that way.

## Commit conventions

- One file per commit, with a descriptive first line (see `git log` for the house style).
- No co-author lines or generated-by trailers unless the repository explicitly asks for them.
- Never commit `.env`, real secret values, private records, or operational data. Labelled engineering fixtures live in `tests/fixtures/engineering/`.
- Do not commit generated build output (`dist/`, `server-dist/`) or local databases (`data/`).

## Before you push

1. `npm run typecheck && npm test` — both must be clean.
2. `npm run docs:check` — no broken links.
3. If the change touched the interface, refresh the screenshots it references (`node scripts/ui-walkthrough.ts <url> <outDir>`) so the README does not show an obsolete screen.
4. If the change touched configuration or commands, walk the README quick start from a fresh clone before calling it verified.
