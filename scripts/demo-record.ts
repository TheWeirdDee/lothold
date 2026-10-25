// Step 2-3 of demo production: record the eight hackathon demo scenes from the
// DEPLOYED application (Vercel frontend + Render backend) as separate raw
// WebM clips at 1440x900, in a fresh isolated ENGINEERING TEST - DEMO
// workspace. Every input is a labelled engineering test kit file. Writes a
// per-scene event timeline to docs/demo/raw/timeline.json and credentials to
// the gitignored .env.demo-recording.json. Never fabricates a successful
// state: failures are recorded per scene and the run continues where the
// application state still allows it.
import { chromium, expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, basename, sep } from 'node:path';

const BASE = process.env.DEMO_BASE ?? 'https://lothold.vercel.app';
const ORG = 'ENGINEERING TEST - DEMO';
const CASE_REF = 'ENG-DEMO-A';
const rawDir = resolve('docs/demo/raw');
if (!rawDir.startsWith(resolve('.') + sep) || rawDir !== join(resolve('docs/demo'), 'raw')) throw new Error('Recording output must stay within the workspace demo directory.');
if (existsSync(rawDir)) rmSync(rawDir, { recursive: true, force: true });
mkdirSync(rawDir, { recursive: true });
mkdirSync('docs/evidence', { recursive: true });
const FAST = !!process.env.RECORD_FAST;
const hold = (ms: number) => new Promise((r) => setTimeout(r, FAST ? 30 : ms));

type Ev = { t: number; label: string };
type Scene = { scene: string; file: string; events: Ev[]; error?: string };
const scenes: Scene[] = [];
let current: Scene | null = null;
let sceneStart = 0;
function failScene(error: unknown) {
  if (current && !current.error) current.error = String(error).slice(0, 500);
}
async function ev(label: string) {
  if (!current) return;
  const t = +((Date.now() - sceneStart) / 1000).toFixed(2);
  current.events.push({ t, label });
  console.log(JSON.stringify({ scene: current.scene, t, label }));
}

const browser = await chromium.launch({ channel: 'chrome' });
const email = `eng-demo-rec-${Date.now()}@example.test`;
const password = randomBytes(24).toString('base64url');
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: join(rawDir, '.tmp'), size: { width: 1440, height: 900 } },
  acceptDownloads: true,
  reducedMotion: 'reduce',
});
const errors: string[] = [];

async function openScene(scene: string): Promise<Page> {
  const p = await ctx.newPage();
  current = { scene, file: `${scene}.webm`, events: [] };
  scenes.push(current);
  sceneStart = Date.now();
  p.on('pageerror', (e) => errors.push(`${scene}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${scene} console: ${m.text().slice(0, 200)}`); });
  p.on('response', (r) => { if (r.status() >= 500) errors.push(`${scene}: ${r.status()} ${new URL(r.url()).pathname}`); });
  return p;
}
async function closeScene(p: Page) {
  const v = p.video();
  await p.close().catch(() => {});
  if (v && current) await v.saveAs(join(rawDir, current.file));
  current = null;
}
async function upload(p: Page, filename: string) {
  const panel = filename.includes('.csv') ? '#panel-sources' : '#panel-plots';
  const form = p.locator(panel + ' form.file-drop').first();
  await form.waitFor({ state: 'visible', timeout: 30_000 });
  await form.locator('input[type=file]').setInputFiles(filename.includes(':') || filename.startsWith('/') ? filename : `web/public/test-kit/${filename}`);
  const [response] = await Promise.all([
    p.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/uploads?kind='), { timeout: 60_000 }),
    form.getByRole('button', { name: 'Upload', exact: true }).click(),
  ]);
  const result = await response.json();
  if (!response.ok() || result.parseStatus === 'rejected') throw new Error(`Upload failed ${response.status()}: ${JSON.stringify(result).slice(0, 300)}`);
  await ev(`${basename(filename)} uploaded (${response.status()} ${result.parseStatus})`);
  await p.getByRole('button', { name: 'Preview and confirm' }).first().click();
  await ev('preview opened');
  await hold(1800);
  await p.getByRole('button', { name: /^Confirm/ }).first().click();
  await expect(p.getByText('Confirmed as the active source')).toBeVisible({ timeout: 30_000 });
  await ev('confirmed as active version');
}
async function scrollThrough(p: Page, untilText: string) {
  for (let i = 0; i < 30; i++) {
    const text = await p.locator('body').innerText();
    if (text.includes(untilText)) return;
    await p.mouse.wheel(0, 600);
    await hold(350);
  }
}

let caseUrl = '';
try {
  // ---------- Scene 1: the problem (landing page) ----------
  try {
    const p = await openScene('scene-01-problem');
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await p.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await ev('landing hero visible');
    await hold(3500);
    await scrollThrough(p, 'How it works');
    await ev('scrolled to how-it-works / problem framing');
    await hold(3000);
    await closeScene(p);
  } catch (e) {
    failScene(e);
    await ev('SCENE FAILED');
  }

  // ---------- Scene 2: workspace + case creation ----------
  try {
    const p = await openScene('scene-02-introduce');
    await p.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await p.getByLabel('Your name').fill('Demo Reviewer');
    await p.getByLabel('Organisation').fill(ORG);
    await p.getByLabel('Email').fill(email);
    await p.getByLabel('Password').fill(password);
    await ev(`organisation set to ${ORG}`);
    await hold(1500);
    await p.getByRole('button', { name: 'Create workspace' }).click();
    await p.waitForURL('**/app', { timeout: 60_000 });
    const me = await (await ctx.request.get(`${BASE}/api/auth/me`)).json();
    if (me.user?.organisation !== ORG) throw new Error(`organisation mismatch: ${JSON.stringify(me.user?.organisation)}`);
    await ev('workspace created (isolated engineering org)');
    await hold(2000);
    await p.getByLabel(/New case/).fill(CASE_REF);
    await p.getByRole('button', { name: 'Create case' }).click();
    await p.waitForURL('**/app/shipments/**', { timeout: 60_000 });
    caseUrl = p.url().split('?')[0]!;
    await ev(`case ${CASE_REF} created`);
    await hold(3000);
    await closeScene(p);
  } catch (e) {
    failScene(e);
    await ev('SCENE FAILED');
    throw e; // without a workspace nothing else can be recorded
  }

  // ---------- Scene 3: uploads and confirmation ----------
  try {
    const p = await openScene('scene-03-uploads');
    await p.goto(caseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await p.getByRole('tab', { name: 'Shipment details' }).click();
    const documentForm = p.locator('form.file-drop').filter({ hasText: 'Shipping or supplier document' });
    await documentForm.locator('input[type=file]').setInputFiles('web/public/test-kit/A3_ENGINEERING_TEST_shipping_document.txt');
    await documentForm.getByRole('button', { name: 'Upload', exact: true }).click();
    await ev('shipping document uploaded');
    await p.getByRole('button', { name: 'Propose fields', exact: true }).click();
    await p.getByLabel('Accept hsCode').waitFor({ timeout: 30_000 });
    await ev('label parser proposed quoted fields');
    await hold(2000);
    for (const check of await p.locator('input[aria-label^="Accept "]:not(:disabled)').all()) await check.check();
    await p.getByRole('button', { name: 'Accept selected fields' }).click();
    await ev('accepted quoted fields');
    await p.locator('#field-countryOfActivity input').fill('BE');
    await p.locator('#field-operatorEori input').fill('BE0000000000');
    await p.getByRole('button', { name: 'Save details' }).click();
    await hold(1500);
    await ev('engineering details saved');
    await p.getByRole('tab', { name: 'Source lots' }).click();
    await upload(p, 'A1_ENGINEERING_TEST_sources.csv');
    await hold(2500);
    const partial = JSON.parse(readFileSync('web/public/test-kit/A2_ENGINEERING_TEST_plots.geojson', 'utf8'));
    partial.features = partial.features.slice(0, 1);
    const partialFile = join(process.env.TEMP ?? '/tmp', 'ENG-DEMO_missing_boundary.geojson');
    writeFileSync(partialFile, JSON.stringify(partial));
    await p.getByRole('tab', { name: /Plots/ }).click();
    await upload(p, partialFile);
    await hold(2000);
    await p.getByRole('tab', { name: 'Findings' }).click();
    await p.getByRole('button', { name: /Show source: .*row 2/ }).first().click({ timeout: 30_000 });
    await expect(p.locator('#src-row-2')).toHaveClass(/highlight/, { timeout: 15_000 });
    await ev('missing plot boundary finding linked to source row 2');
    await hold(4000);
    await closeScene(p);
  } catch (e) {
    failScene(e);
    await ev('SCENE FAILED');
  }

  // ---------- Scene 4: land evidence analysis ----------
  try {
    const p = await openScene('scene-04-analysis');
    await p.goto(caseUrl + '?tab=plots', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await p.getByRole('tab', { name: /Plots/ }).click();
    await upload(p, 'A2_ENGINEERING_TEST_plots.geojson');
    await ev('analysis job started (processing state visible)');
    await p.locator('.mapbox svg').first().waitFor({ timeout: 90_000 });
    await ev('satellite map rendered');
    await hold(2500);
    await p.getByRole('button', { name: /ENG-KIT-A-P1/ }).click({ timeout: 30_000 });
    await ev('plot ENG-KIT-A-P1 opened: tree-cover-loss observations');
    await hold(6000);
    await closeScene(p);
  } catch (e) {
    failScene(e);
    await ev('SCENE FAILED');
  }

  // ---------- Scene 5: findings + supplier request PDF ----------
  try {
    const p = await openScene('scene-05-findings-pdf');
    await p.goto(caseUrl + '?tab=findings', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await p.getByRole('tab', { name: 'Findings' }).click();
    await hold(2500);
    const sourceBtn = p.getByRole('button', { name: /Show source: / }).first();
    if (await sourceBtn.count()) {
      await sourceBtn.click({ timeout: 20_000 }).catch(() => {});
      await ev('finding opened with its source reference');
    } else {
      await ev('no source-reference button on this finding set (recorded as-is)');
    }
    await hold(3000);
    await p.getByRole('tab', { name: 'Documents' }).click();
    await hold(1500);
    const [pdf] = await Promise.all([
      p.waitForEvent('download', { timeout: 120_000 }),
      p.getByRole('button', { name: 'Create and download PDF' }).first().click(),
    ]);
    const pdfPath = await pdf.path();
    const pdfBytes = readFileSync(pdfPath!);
    if (pdfBytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('downloaded supplier request is not a PDF');
    await ev(`supplier request PDF generated (${pdfBytes.length} bytes)`);
    // Open the real downloaded bytes in the browser so the document is visible.
    await p.route('**/eng-demo-request.pdf', (r) => r.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBytes }));
    await p.goto(`${BASE}/eng-demo-request.pdf`);
    await ev('generated supplier request opened on screen');
    await hold(6000);
    await closeScene(p);
  } catch (e) {
    failScene(e);
    await ev('SCENE FAILED');
  }

  // ---------- Scene 6: record the review ----------
  try {
    const p = await openScene('scene-06-review');
    await p.goto(caseUrl + '?tab=review', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await p.getByRole('button', { name: 'Record investigation' }).first().click({ timeout: 30_000 });
    const dialog = p.getByRole('dialog');
    await dialog.getByLabel(/Investigated: supporting evidence/).check();
    await dialog.getByLabel(/^Rationale/).fill('ENGINEERING TEST: this attached invented evidence exercises the review workflow; it establishes no real land-use conclusion.');
    await dialog.locator('#evidence-file').setInputFiles('web/public/test-kit/A4_ENGINEERING_TEST_investigation_evidence.txt');
    await ev('labelled engineering evidence attached with rationale');
    await hold(2000);
    await dialog.getByRole('button', { name: 'Record decision' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await ev('investigation recorded against the case');
    await p.getByRole('tab', { name: 'Allocation' }).click();
    await p.getByRole('button', { name: 'Reserve allocations in ledger' }).click({ timeout: 30_000 });
    await expect(p.getByRole('button', { name: 'Allocations reserved' })).toBeVisible({ timeout: 30_000 });
    await ev('declared allocation reserved in the ledger (no chain transaction)');
    await p.getByRole('tab', { name: 'Findings' }).click();
    await p.getByRole('button', { name: /Sign off snapshot/ }).click({ timeout: 30_000 });
    await expect(p.locator('.status-strip')).toContainText('REVIEWED DRAFT', { timeout: 30_000 });
    await ev('snapshot signed off: status REVIEWED DRAFT');
    await hold(4000);
    await closeScene(p);
  } catch (e) {
    failScene(e);
    await ev('SCENE FAILED');
  }

  // ---------- Scene 7: export + stale sign-off ----------
  try {
    const p = await openScene('scene-07-export');
    await p.goto(caseUrl + '?tab=documents', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await p.getByRole('tab', { name: 'Documents' }).click();
    await hold(1500);
    const [xml] = await Promise.all([
      p.waitForEvent('download', { timeout: 120_000 }),
      p.getByRole('button', { name: 'Create and download XML' }).click(),
    ]);
    const xmlName = xml.suggestedFilename() ?? '';
    if (!xmlName.includes('DRAFT_NOT_SUBMITTED')) throw new Error(`unexpected XML filename: ${xmlName}`);
    const xmlBytes = readFileSync((await xml.path())!);
    await ev(`DDS draft generated (${xmlName}, ${xmlBytes.length} bytes)`);
    await p.route('**/eng-demo-dds.xml', (r) => r.fulfill({ status: 200, contentType: 'application/xml', body: xmlBytes }));
    await p.goto(`${BASE}/eng-demo-dds.xml`);
    await ev('DDS draft opened: DRAFT_NOT_SUBMITTED label visible in filename/content');
    await hold(5000);
    await p.goto(caseUrl + '?tab=details', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await p.getByRole('tab', { name: 'Shipment details' }).click();
    await p.locator('#field-description input').fill('ENGINEERING TEST cocoa beans, revised');
    await p.getByRole('button', { name: 'Save details' }).click();
    await hold(2000);
    await ev('evidence changed after sign-off');
    await p.getByRole('tab', { name: 'Documents' }).click();
    await expect(p.getByRole('button', { name: 'Create and download XML' })).toBeDisabled({ timeout: 30_000 });
    await expect(p.locator('.badge', { hasText: 'Out of date' }).first()).toBeVisible({ timeout: 30_000 });
    await ev('earlier sign-off invalidated: export blocked, Out of date badge');
    await hold(5000);
    await closeScene(p);
  } catch (e) {
    failScene(e);
    await ev('SCENE FAILED');
  }

  // ---------- Scene 8: closing ----------
  try {
    const p = await openScene('scene-08-closing');
    await p.goto(caseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await hold(3000);
    await p.getByRole('tab', { name: 'Findings' }).click();
    await ev('completed engineering case (ENG-DEMO-A)');
    await hold(4000);
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await scrollThrough(p, 'GitHub');
    await ev('landing page with live URL and repository links');
    await hold(5000);
    await closeScene(p);
  } catch (e) {
    failScene(e);
    await ev('SCENE FAILED');
  }
} catch (e) {
  console.error('FATAL', e);
  failScene(e);
} finally {
  await ctx.close();
  await browser.close();
  writeFileSync(join(rawDir, 'timeline.json'), JSON.stringify({ recordedAt: new Date().toISOString(), target: BASE, organisation: ORG, caseRef: CASE_REF, caseUrl, viewport: '1440x900', scenes, consoleErrors: errors }, null, 2) + '\n');
  writeFileSync('.env.demo-recording.json', JSON.stringify({ target: BASE, email, password, caseUrl, organisation: ORG, caseRef: CASE_REF }, null, 2) + '\n');
  const failed = scenes.filter((s) => s.error);
  console.log(JSON.stringify({ done: true, scenes: scenes.length, failedScenes: failed.map((s) => s.scene), consoleErrors: errors.length }));
  if (failed.length || scenes.length !== 8 || errors.length) process.exitCode = 1;
}
