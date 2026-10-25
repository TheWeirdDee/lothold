// Real UI recording + cross-device/restart checks. Owns a throwaway engineering
// backend and never loads .env or writes to the operational database.
import { chromium, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'lothold-recording-'));
const port = 8804;
const base = `http://127.0.0.1:${port}`;
const mediaDir = resolve('web/public/media');
mkdirSync(mediaDir, { recursive: true });
mkdirSync('docs/evidence', { recursive: true });
const env = { ...process.env, DATABASE_PATH: join(dir, 'db.sqlite'), EVIDENCE_DIR: join(dir, 'evidence'), PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', PUBLIC_ORIGIN: base, EVIDENCE_ENCRYPTION_KEY: randomBytes(32).toString('hex'), DOWNLOAD_SIGNING_KEY: randomBytes(32).toString('hex'), LOTHOLD_INSTANCE: 'engineering', REGISTER_RATE_LIMIT: '1000', CHAIN_ANCHORING: 'off', AI_PROVIDER: '', REGISTRATION_OPEN: 'true' };
let server: ChildProcess | null = null;
async function start() {
  server = spawn(process.execPath, ['server/main.ts'], { env, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 180; i++) {
    if (server.exitCode !== null) throw new Error('Engineering server exited');
    try { const r = await fetch(`${base}/api/ready?strict=1`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Engineering server did not become fully ready');
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const done = new Promise<void>((r) => server!.once('exit', () => r())); server.kill(); await done; server = null;
}
const browser = await chromium.launch({ channel: 'chrome' });
const errors: string[] = [];
const email = `recording-${Date.now()}@example.test`, password = 'engineering-recording-pw';
const chapters: { seconds: number; text: string }[] = [];
let started = 0;
async function chapter(p: Page, text: string, ms = 3500) {
  chapters.push({ seconds: Math.max(0, (Date.now() - started) / 1000), text });
  console.log(JSON.stringify({ chapter: text }));
  await p.waitForTimeout(process.env.RECORD_FAST ? 30 : ms);
}
async function upload(p: Page, filename: string) {
  const panel = filename.endsWith('.csv') ? '#panel-sources' : '#panel-plots';
  const form = p.locator(panel + ' form.file-drop').first();
  await form.waitFor({ state: 'visible' });
  await form.locator('input[type=file]').setInputFiles(filename.includes(':') ? filename : `web/public/test-kit/${filename}`);
  console.log(JSON.stringify({beforeUpload: basename(filename), url: p.url(), input: await form.locator('input[type=file]').inputValue()}));
  const [response] = await Promise.all([p.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/uploads?kind=')), form.getByRole('button', { name: 'Upload', exact: true }).click()]);
  const result = await response.json(); console.log(JSON.stringify({ upload: basename(filename), status: response.status(), result }));
  if (!response.ok() || result.parseStatus === 'rejected') throw new Error('Upload failed: ' + JSON.stringify(result));
  await p.getByRole('button', { name: 'Preview and confirm' }).first().click();
  await chapter(p, `Inspect the parsed preview of ${basename(filename)}. Confirming makes this version active.`, 2500);
  await p.getByRole('button', { name: /^Confirm/ }).first().click();
  await expect(p.getByText('Confirmed as the active source')).toBeVisible();
}
try {
  await start();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, recordVideo: { dir: join(dir, 'full'), size: { width: 1280, height: 720 } }, reducedMotion: 'reduce', acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  started = Date.now();
  await p.goto(`${base}/register`);
  await p.getByLabel('Your name').fill('Engineering Reviewer');
  await p.getByLabel('Organisation').fill('ENGINEERING RECORDING ONLY');
  await p.getByLabel('Email').fill(email); await p.getByLabel('Password').fill(password);
  await p.getByRole('button', { name: 'Create workspace' }).click(); await p.waitForURL('**/app');
  await p.getByLabel(/New case/).fill('ENG-RECORDED-WALKTHROUGH');
  await p.getByRole('button', { name: 'Create case' }).click(); await p.waitForURL('**/app/shipments/**');
  const caseUrl = p.url().split('?')[0]!;
  await chapter(p, 'This is a separate engineering instance. The cases, quantities and coordinate probe boxes are not commercial records or farms.');
  await p.getByRole('tab', { name: 'Shipment details' }).click();
  const documentForm = p.locator('form.file-drop').filter({ hasText: 'Shipping or supplier document' });
  await documentForm.locator('input[type=file]').setInputFiles('web/public/test-kit/A3_ENGINEERING_TEST_shipping_document.txt');
  await documentForm.getByRole('button', { name: 'Upload', exact: true }).click();
  await p.getByRole('button', { name: 'Propose fields', exact: true }).click();
  await p.getByLabel('Accept hsCode').waitFor();
  await chapter(p, 'Upload a labelled document. The deterministic label parser is not AI. Each proposed field quotes its source.');
  for (const check of await p.locator('input[aria-label^="Accept "]:not(:disabled)').all()) await check.check();
  await p.getByRole('button', { name: 'Accept selected fields' }).click();
  await p.locator('#field-countryOfActivity input').fill('BE');
  await p.locator('#field-operatorEori input').fill('BE0000000000');
  await p.getByRole('button', { name: 'Save details' }).click();
  await chapter(p, 'Accept the quoted fields and enter the remaining engineering details. No official operator identity is represented.');
  await p.getByRole('tab', { name: 'Source lots' }).click();
  await upload(p, 'A1_ENGINEERING_TEST_sources.csv');
  const partial = JSON.parse(readFileSync('web/public/test-kit/A2_ENGINEERING_TEST_plots.geojson', 'utf8'));
  partial.features = partial.features.slice(0, 1);
  const partialFile = join(dir, 'ENGINEERING_TEST_missing_boundary.geojson');
  writeFileSync(partialFile, JSON.stringify(partial));
  await p.getByRole('tab', { name: /Plots/ }).click();
  await upload(p, partialFile);
  await p.getByRole('tab', { name: 'Findings' }).click();
  await chapter(p, 'A missing plot boundary holds the case. Follow the finding to the exact source row.');
  await p.getByRole('button', { name: /Show source: .*row 2/ }).first().click();
  await expect(p.locator('#src-row-2')).toHaveClass(/highlight/);
  await chapter(p, 'The source row references the missing plot. These are declared engineering quantities.');
  await p.getByRole('tab', { name: /Plots/ }).click();
  await upload(p, 'A2_ENGINEERING_TEST_plots.geojson');
  await expect(p.locator('.mapbox svg').first()).toBeVisible({ timeout: 30000 });
  await p.getByRole('button', { name: /ENG-KIT-A-P1/ }).click();
  await chapter(p, 'Inspect real pinned Hansen and JRC pixels inside a coordinate probe box. The shape is not a farm.');
  await p.screenshot({ path: join(mediaDir, 'lothold-poster.jpg'), type: 'jpeg', quality: 92 });
  await p.getByRole('tab', { name: 'Documents' }).click();
  const [pdf] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Create and download PDF' }).first().click()]);
  const pdfBytes = readFileSync((await pdf.path())!);
  if (pdfBytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Supplier PDF missing');
  await chapter(p, 'Generate the supplier evidence request from outstanding findings. The download is a real PDF.');
  await p.route('**/recorded-request.pdf', (r) => r.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBytes }));
  await p.goto(`${base}/recorded-request.pdf`);
  await chapter(p, 'Open the generated supplier request PDF. It asks for evidence and does not certify compliance.', 5500);
  await p.goto(caseUrl + '?tab=review');
  await p.getByRole('button', { name: 'Record investigation' }).first().click();
  const dialog = p.getByRole('dialog');
  await dialog.getByLabel(/Investigated: supporting evidence/).check();
  await dialog.getByLabel(/^Rationale/).fill('ENGINEERING TEST: this attached invented evidence exercises the review workflow; it establishes no real land-use conclusion.');
  await dialog.locator('#evidence-file').setInputFiles('web/public/test-kit/A4_ENGINEERING_TEST_investigation_evidence.txt');
  await chapter(p, 'Attach clearly labelled engineering evidence and record a rationale. A real review would need relevant independent records.');
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await p.getByRole('tab', { name: 'Allocation' }).click();
  await p.getByRole('button', { name: 'Reserve allocations in ledger' }).click();
  await expect(p.getByRole('button', { name: 'Allocations reserved' })).toBeVisible();
  await chapter(p, 'Reserve the declared allocation in the database ledger. No blockchain transaction is sent in this recording.');
  await p.getByRole('tab', { name: 'Findings' }).click();
  await p.getByRole('button', { name: /Sign off snapshot/ }).click();
  await expect(p.locator('.status-strip')).toContainText('REVIEWED DRAFT');
  await chapter(p, 'Sign off the exact evidence snapshot. This remains a reviewed draft, never an official submission.');
  await p.getByRole('tab', { name: 'Documents' }).click();
  const [xml] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Create and download XML' }).click()]);
  expect(xml.suggestedFilename()).toContain('DRAFT_NOT_SUBMITTED');
  await chapter(p, 'Export a DDS XML draft only after sign-off and schema validation. No official reference number is invented.');
  await p.getByRole('tab', { name: 'Shipment details' }).click();
  await p.locator('#field-description input').fill('ENGINEERING TEST cocoa beans, revised');
  await p.getByRole('button', { name: 'Save details' }).click();
  await p.getByRole('tab', { name: 'Documents' }).click();
  await expect(p.getByRole('button', { name: 'Create and download XML' })).toBeDisabled();
  await expect(p.locator('.badge', { hasText: 'Out of date' }).first()).toBeVisible();
  await chapter(p, 'Change the evidence. Earlier sign-off and documents become out of date; XML export is blocked until a new review.', 5500);
  const duration = (Date.now() - started) / 1000;
  const fullVideo = p.video()!;
  await ctx.close(); await fullVideo.saveAs(join(mediaDir, 'lothold-full.webm'));
  const time = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;
  writeFileSync(join(mediaDir, 'lothold.en.vtt'), 'WEBVTT\n\n' + chapters.map((c, i) => `${i + 1}\n${time(c.seconds)} --> ${time(chapters[i + 1]?.seconds ?? duration)}\n${c.text}\n`).join('\n'));

  // A fresh browser has no cookie. Log in to the same account and see the same case.
  const second = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', recordVideo: { dir: join(dir, 'short'), size: { width: 1280, height: 720 } } });
  const q = await second.newPage(); await q.goto(`${base}/login`);
  await q.getByLabel('Email').fill(email); await q.getByLabel('Password').fill(password);
  await q.getByRole('button', { name: 'Sign in', exact: true }).click(); await q.waitForURL('**/app');
  await expect(q.getByRole('link', { name: 'ENG-RECORDED-WALKTHROUGH' })).toBeVisible();
  await q.getByRole('link', { name: 'ENG-RECORDED-WALKTHROUGH' }).click();
  await q.getByRole('tab', { name: /Plots/ }).click();
  await q.waitForTimeout(3000);
  const previewPage = await second.newPage();
  const clip = previewPage.video()!;
  await previewPage.goto(caseUrl + '?tab=plots'); await previewPage.waitForTimeout(4000);
  await previewPage.getByRole('tab', { name: 'Findings' }).click(); await previewPage.waitForTimeout(4000);
  await previewPage.getByRole('tab', { name: 'Documents' }).click(); await previewPage.waitForTimeout(4000);
  await second.close(); await clip.saveAs(join(mediaDir, 'lothold-short.webm'));

  // Restart the owned process with the SAME database, evidence directory and keys.
  await stop(); await start();
  const third = await browser.newContext(); const r = await third.newPage();
  await r.goto(`${base}/login`); await r.getByLabel('Email').fill(email); await r.getByLabel('Password').fill(password);
  await r.getByRole('button', { name: 'Sign in', exact: true }).click(); await r.waitForURL('**/app');
  await r.getByRole('link', { name: 'ENG-RECORDED-WALKTHROUGH' }).click();
  await r.getByRole('tab', { name: 'Documents' }).click();
  await expect(r.locator('.badge', { hasText: 'Out of date' }).first()).toBeVisible();
  const link = await r.context().request.get(base + '/api/auth/me'); expect((await link.json()).user.organisation).toBe('ENGINEERING RECORDING ONLY');
  // Decrypt and download the stored original PDF after restart through its signed URL.
  const sid = caseUrl.split('/').pop()!;
  const docs = await r.context().request.get(`${base}/api/shipments/${sid}/documents`);
  const stored = (await docs.json()).documents.find((d: any) => d.kind === 'supplier_request_pdf');
  const me = await (await r.context().request.get(base + '/api/auth/me')).json();
  const dl = await r.context().request.post(`${base}/api/documents/${stored.id}/download-link`, { headers: { origin: base, 'x-csrf-token': me.csrf } });
  const bytes = await (await r.context().request.get(base + (await dl.json()).url)).body();
  expect(bytes.equals(pdfBytes)).toBe(true);
  await r.getByRole('button', { name: 'Sign out' }).click();
  expect((await (await r.context().request.get(base + '/api/auth/me')).json()).user).toBeNull();
  await third.close();
  expect(errors).toEqual([]);
  writeFileSync('docs/evidence/experience-recording.json', JSON.stringify({ recordedAt: new Date().toISOString(), engineeringOnly: true, fullDurationSeconds: duration, chapters, checks: { actualUIRecording: true, pdfOpened: true, xmlDraft: true, staleExportBlocked: true, crossContextLogin: true, backendRestartSameDatabaseAndKeys: true, evidenceDecryptionAfterRestart: true, logout: true, unexpectedServerOrPageErrors: errors } }, null, 2) + '\n');
  console.log('Recording and persistence verification complete.');
} catch(e) { for (const context of browser.contexts()) for(const page of context.pages()) { await page.screenshot({path:'docs/screenshots/recording-failure.png',fullPage:true}).catch(()=>{}); console.log((await page.locator('body').innerText().catch(()=>'' )).slice(0,5000)); } throw e; } finally { await browser.close(); await stop(); }
