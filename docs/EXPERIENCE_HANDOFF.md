> Reliability follow-up (25 October 2026): [current verification and manual actions](FREE_HOSTING_VALIDATION.md), [checkpoint protocol](CHECKPOINT_PROTOCOL.md), and [free-tier usage](FREE_TIER_USAGE.md). Earlier counts and hosting statements below are historical; they do not validate a free hosted deployment.

> Updated free-project preparation: see [FREE_HOSTING_SETUP.md](FREE_HOSTING_SETUP.md). Its checkpoint setup supersedes older hosting recommendations below. No cloud deployment has been verified.

# LotHold public-experience handoff — 25 October 2026

Implemented locally; no push, external deployment, purchase or account migration performed.

## Connection

The public Vercel root returned 200, but every inspected API route returned Vercel's plain-text 404 (`health`, `auth/me`, `public/method`, `public/demo-video`, `public/verify`). The deployed frontend has no API route to a persistent LotHold backend. Local account, upload, analysis, review and export workflows work against the real Node server. Public hosting remains disconnected until infrastructure is supplied and deployed.

Exact configuration and operator actions: [EXPERIENCE_HOSTING.md](EXPERIENCE_HOSTING.md). Prepared artifacts: `deploy/compose.yaml`, `deploy/Caddyfile.container`, `deploy/hosting.env.example`, and the optional Vercel-routing generator. Compose YAML and volume/port/health configuration were checked; the new Compose stack has not been launched on a host. No Docker executable was available in this shell.

## Delivered

- Landing story reordered: hero, problem, solution, real recording, process, outputs, evidence sources, animated FAQ, closing action/footer. Consistent “Open workspace” primary action.
- Content-driven section rhythm, fluid type and responsive columns; removed the oversized technical closing strip and animation-dependent hidden content.
- `/docs` user guide, anchored chapters, desktop contents and mobile contents control; static CSV template.
- Expanded static methods register generated from implemented dataset/version metadata during every build. Live availability is separate. No placeholder rule/method punctuation.
- Historical public engineering registry evidence remains inspectable offline, labelled as historical; live counts stay unknown and lookup is disabled when disconnected.
- Marketing footer only on landing; compact utility links on public/auth pages; no marketing footer in the workspace.
- Mobile hamburger/close icon with native modal focus handling, Escape, route selection closure, scroll locking, focus restoration and short-screen scrolling.
- Accessible FAQ with heading/button semantics, expanded state, animated content/indicator and reduced-motion behavior.
- GSAP was absent before this change. `gsap` 3.15.0 is now installed and imported for scoped hero/section/process motion and mobile navigation entry. MatchMedia/context cleanup handles route changes and reduced motion. Content never relies on zero opacity or scroll pinning.
- Real engineering UI recordings: about 64 seconds full walkthrough, a separate short muted preview, sharp actual-application poster, timed English captions and transcript. Static files work without any API. Heavy video requests wait for interaction; pause/fullscreen/native controls are verified.

## Verification

| Check | Result |
|---|---|
| TypeScript | Pass |
| Production build | Pass |
| Unit/integration | 110 tests, 11 files, pass |
| Final Chrome browser suite | 19 tests, pass (adds cross-device login and the inspector's no-server notice) |
| Public API absent | Landing, Docs, methods, inspector instructions, test kit, historical registry and recording remain usable; live operations report unavailable |
| Actual authenticated workflow | Upload/preview/confirm, document field proposal/acceptance, source-linked finding, real raster result, investigation, PDF, reservation, sign-off, XML and stale-state export block pass |
| Accounts across contexts | Same account in a new isolated browser sees the same organisation/case |
| Restart persistence | Same backend database/keys survive process restart; login, case, stale document state and byte-identical decrypted PDF download pass |
| Logout | Server session ends and `/api/auth/me` returns null |
| Video | Actual shipped recordings play/pause at 1440 and 390 px without API; English captions and fullscreen pass; PDF opening visually confirmed in recorded frame |
| Mobile navigation / FAQ | Keyboard, focus, Escape, selection, scroll lock and expanded-state checks pass |
| Automated accessibility | Public pages including Docs at 1440/390, authenticated tabs/dialog and keyboard/live-region checks pass |
| Responsive layout | 320, 360, 390, 480, 768, 900, 1024, 1440 px; full-page and fold captures, no overflow/clipped headings; inspected section balance |
| Reflow/text spacing | 720 CSS px @2x (200% equivalent) plus line/letter/word spacing overrides; passes width check; no claim of a manual browser zoom session |
| Console/network | No unexpected page/server/asset errors in connected visual capture; expected API 404s are injected only in explicit disconnected-state tests |

Evidence: [recording and account/restart checks](evidence/experience-recording.json), [layout checks](evidence/experience-layout.json), [desktop landing](screenshots/experience/landing-1440-full.png), [mobile landing](screenshots/experience/landing-390-full.png), [mobile navigation](screenshots/experience/navigation-390.png), [actual PDF frame](screenshots/experience/recorded-pdf-frame.png).

## Account architecture

Accounts, scrypt hashes, organisations, sessions and authoritative cases are server-side in SQLite. The browser holds an HttpOnly session cookie. Protected operations scope by authenticated organisation. AES-256-GCM evidence files and SQLite must share durable server storage; the prepared deployment uses `/data`. Stable operator-managed encryption/download keys survive redeploys separately from the image. Session continuity comes from SQLite, not a freshly generated signing secret. The current public Vercel frontend has no production database/volume identified. Supabase is unnecessary for cross-device login in this architecture.

## Remaining external/manual limits

1. Supply a persistent host and DNS, configure stable keys and the public HTTPS origin, provision the pinned rasters, and launch the prepared stack. If no existing host is available, hosting-account/billing selection and spending authorisation are needed. Then verify TLS, proxy cookies, uploads and recovery on the actual hosted URL. The runbook contains exact commands.
2. The eight reference screenshots were not present in the attachment directory; only the request text was supplied. Fixes were checked against the current implementation and 31 fresh captures, not against missing images.
3. Manual screen-reader/forced-colour testing, actual commercial records, provider-live AI reliability and cross-browser Safari/Firefox testing remain outside the verified evidence. No claim of legal compliance or genuine commercial inventory is made.

## Follow-up (same day)

- This work was not committed by the session that wrote it; it was reviewed, completed and committed afterwards, one file per commit.
- Added:
  - a browser test for login from a second isolated context, interface sign-out (server session ended) and isolation from a different organisation;
  - the forest inspector's honest "needs the LotHold server" notice, with a disabled run button when the API is absent;
  - stacked, labelled phone layouts for the registry steps and the Docs CSV table, which were clipped at 390 px.
- Rules version bumped to `lothold-rules/2026-10-25.1` for the build-audit rule changes.
- The auth slogan now states the page's purpose.
- Docs cover the lot-total correction, analysis retry, supplier email and overlap rule.
- The prepared Compose and Caddy stack was run end to end in Docker under WSL2; see `EXPERIENCE_HOSTING.md` and `evidence/compose-verification.json`.
