// Step 1 of demo production: validate the full demo workflow against the
// DEPLOYED application (Vercel frontend + Render backend) using only clearly
// labelled engineering test records. Records every step's outcome - including
// failures and skipped steps - to docs/evidence/demo-workflow-validation.json.
// Never bypasses a hold or approval requirement, and never invents success.
import { chromium, expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const BASE = process.env.DEMO_BASE ?? 'https://lothold.vercel.app';
const ORG = 'ENGINEERING TEST - DEMO';
const CASE_REF = 'ENG-DEMO-A';
const out = resolve('docs/evidence/demo-workflow-validation.json');
mkdirSync('docs/evidence', { recursive: true });

type Step = { step: string; ok: boolean; detail?: string; seconds?: number };
const steps: Step[] = [];
const consoleErrors: string[] = [];
async function step(name: string, work: () => Promise<string | void>): Promise<boolean> {
  const t = Date.now();
  try {
    const detail = await work();
    steps.push({ step: name, ok: true, detail: typeof detail === 'string' ? detail : undefined, seconds: +((Date.now() - t) / 1000).toFixed(1) });
    console.log(JSON.stringify({ ok: true, step: name }));
    return true;
  } catch (e) {
    const detail = String(e instanceof Error ? (e.stack ?? e.message) : e).slice(0, 1500);
    steps.push({ step: name, ok: false, detail, seconds: +((Date.now() - t) / 1000).toFixed(1) });
    console.log(JSON.stringify({ ok: false, step: name, detail: detail.slice(0, 300) }));
    return false;
  }
}
function save(extra: Record<string, unknown> = {}) {
  writeFileSync(out, JSON.stringify({
    checkedAt: new Date().toISOString(),
    target: BASE,
    scope: 'Isolated ENGINEERING TEST - DEMO workspace on the authorized live deployment; all inputs are labelled engineering test kit files, never real shipments or farms.',
    steps,
    passed: steps.filter((s) => s.ok).length,
    failed: steps.filter((s) => !s.ok).map((s) => s.step),
    consoleErrors,
    ...extra,
  }, null, 2) + '\n');
}

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, reducedMotion: 'reduce' });
const p = await ctx.newPage();
p.on('pageerror', (e) => consoleErrors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
p.on('response', (r) => { if (r.status() >= 500) consoleErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); });

const email = `eng-demo-${Date.now()}@example.test`;
const password = randomBytes(24).toString('base64url');
let caseUrl = '';

async function upload(p: Page, filename: string) {
  const panel = filename.endsWith('.csv') || filename.includes('.csv') ? '#panel-sources' : '#panel-plots';
  const form = p.locator(panel + ' form.file-drop').first();
  await form.waitFor({ state: 'visible', timeout: 30_000 });
  await form.locator('input[type=file]').setInputFiles(filename.includes(':') || filename.startsWith('/') ? filename : `web/public/test-kit/${filename}`);
  const [response] = await Promise.all([
    p.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/uploads?kind='), { timeout: 60_000 }),
    form.getByRole('button', { name: 'Upload', exact: true }).click(),
  ]);
  const result = await response.json();
  if (!response.ok() || result.parseStatus === 'rejected') throw new Error(`Upload failed ${response.status()}: ${JSON.stringify(result).slice(0, 400)}`);
  await p.getByRole('button', { name: 'Preview and confirm' }).first().click();
  await p.getByRole('button', { name: /^Confirm/ }).first().click();
  await expect(p.getByText('Confirmed as the active source')).toBeVisible({ timeout: 30_000 });
  return `${basename(filename)} -> ${response.status()} ${result.parseStatus}`;
}

try {
  // --- Registration / workspace ---
  const regOk = await step('register workspace (ENGINEERING TEST - DEMO)', async () => {
    await p.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await p.getByLabel('Your name').fill('Demo Reviewer');
    await p.getByLabel('Organisation').fill(ORG);
    await p.getByLabel('Email').fill(email);
    await p.getByLabel('Password').fill(password);
    await p.getByRole('button', { name: 'Create workspace' }).click();
    await p.waitForURL('**/app', { timeout: 60_000 });
    const me = await (await ctx.request.get(`${BASE}/api/auth/me`)).json();
    if (me.user?.organisation !== ORG) throw new Error(`organisation mismatch: ${JSON.stringify(me.user?.organisation)}`);
    return `org=${me.user.organisation}`;
  });
  save();
  if (!regOk) throw new Error('registration blocked; remaining steps impossible');

  await step('create case ' + CASE_REF, async () => {
    await p.getByLabel(/New case/).fill(CASE_REF);
    await p.getByRole('button', { name: 'Create case' }).click();
    await p.waitForURL(`**/app/shipments/**`, { timeout: 60_000 });
    caseUrl = p.url().split('?')[0]!;
    return caseUrl;
  });

  // --- Shipment details from the labelled shipping document ---
  await step('upload shipping document + propose fields (label parser)', async () => {
    await p.getByRole('tab', { name: 'Shipment details' }).click();
    const documentForm = p.locator('form.file-drop').filter({ hasText: 'Shipping or supplier document' });
    await documentForm.locator('input[type=file]').setInputFiles('web/public/test-kit/A3_ENGINEERING_TEST_shipping_document.txt');
    await documentForm.getByRole('button', { name: 'Upload', exact: true }).click();
    await p.getByRole('button', { name: 'Propose fields', exact: true }).click();
    await p.getByLabel('Accept hsCode').waitFor({ timeout: 30_000 });
    for (const check of await p.locator('input[aria-label^="Accept "]:not(:disabled)').all()) await check.check();
    await p.getByRole('button', { name: 'Accept selected fields' }).click();
    return 'proposed and accepted quoted fields';
  });

  await step('enter remaining engineering details', async () => {
    await p.locator('#field-countryOfActivity input').fill('BE');
    await p.locator('#field-operatorEori input').fill('BE0000000000');
    await p.getByRole('button', { name: 'Save details' }).click();
    await p.waitForTimeout(1500);
    return 'countryOfActivity=BE, operatorEori=BE0000000000';
  });

  // --- Source lots + partial plot upload producing the missing-boundary finding ---
  await step('upload source CSV + preview/confirm', async () => {
    await p.getByRole('tab', { name: 'Source lots' }).click();
    return await upload(p, 'A1_ENGINEERING_TEST_sources.csv');
  });

  await step('upload partial plots -> missing-boundary finding', async () => {
    const partial = JSON.parse(readFileSync('web/public/test-kit/A2_ENGINEERING_TEST_plots.geojson', 'utf8'));
    partial.features = partial.features.slice(0, 1);
    const partialFile = join(process.env.TEMP ?? '/tmp', 'ENG-DEMO_missing_boundary.geojson');
    writeFileSync(partialFile, JSON.stringify(partial));
    await p.getByRole('tab', { name: /Plots/ }).click();
    return await upload(p, partialFile);
  });

  await step('finding links to exact source row', async () => {
    await p.getByRole('tab', { name: 'Findings' }).click();
    await p.getByRole('button', { name: /Show source: .*row 2/ }).first().click({ timeout: 30_000 });
    await expect(p.locator('#src-row-2')).toHaveClass(/highlight/, { timeout: 15_000 });
    return 'source row 2 highlighted';
  });

  // --- Full plots + real satellite analysis ---
  await step('upload full plots + run satellite analysis', async () => {
    await p.getByRole('tab', { name: /Plots/ }).click();
    const r = await upload(p, 'A2_ENGINEERING_TEST_plots.geojson');
    await p.locator('.mapbox svg').first().waitFor({ timeout: 60_000 });
    return r;
  });

  await step('open plot -> tree-cover-loss observations', async () => {
    await p.getByRole('button', { name: /ENG-KIT-A-P1/ }).click({ timeout: 30_000 });
    await p.waitForTimeout(2500);
    const text = await p.locator('body').innerText();
    const m = text.match(/(?:tree[- ]cover loss|Tree[- ]cover loss)[\s\S]{0,200}/);
    if (!m) {
      const alt = text.includes('Hansen') || text.includes('loss year') || text.includes('Loss year');
      if (!alt) throw new Error('no loss-year observation text found on plot panel');
      return 'plot panel shows Hansen/JRC observation text';
    }
    return m[0].replace(/\s+/g, ' ').slice(0, 240);
  });

  // --- Findings + supplier request PDF ---
  await step('generate supplier-request PDF (real download)', async () => {
    await p.getByRole('tab', { name: 'Documents' }).click();
    const [pdf] = await Promise.all([
      p.waitForEvent('download', { timeout: 120_000 }),
      p.getByRole('button', { name: 'Create and download PDF' }).first().click(),
    ]);
    const path = await pdf.path();
    const bytes = readFileSync(path!);
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('downloaded file is not a PDF');
    return `${pdf.suggestedFilename()} ${bytes.length} bytes`;
  });

  // --- Record investigation ---
  await step('record investigation with labelled evidence', async () => {
    await p.goto(caseUrl + '?tab=review', { waitUntil: 'domcontentloaded' });
    await p.getByRole('button', { name: 'Record investigation' }).first().click({ timeout: 30_000 });
    const dialog = p.getByRole('dialog');
    await dialog.getByLabel(/Investigated: supporting evidence/).check();
    await dialog.getByLabel(/^Rationale/).fill('ENGINEERING TEST: this attached invented evidence exercises the review workflow; it establishes no real land-use conclusion.');
    await dialog.locator('#evidence-file').setInputFiles('web/public/test-kit/A4_ENGINEERING_TEST_investigation_evidence.txt');
    await dialog.getByRole('button', { name: 'Record decision' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    return 'investigation recorded';
  });

  // --- Allocation reservation ---
  await step('reserve allocations in ledger', async () => {
    await p.getByRole('tab', { name: 'Allocation' }).click();
    await p.getByRole('button', { name: 'Reserve allocations in ledger' }).click({ timeout: 30_000 });
    await expect(p.getByRole('button', { name: 'Allocations reserved' })).toBeVisible({ timeout: 30_000 });
    return 'reserved (no blockchain transaction)';
  });

  // --- Sign-off ---
  const signOffOk = await step('sign off snapshot -> REVIEWED DRAFT', async () => {
    await p.getByRole('tab', { name: 'Findings' }).click();
    await p.getByRole('button', { name: /Sign off snapshot/ }).click({ timeout: 30_000 });
    await expect(p.locator('.status-strip')).toContainText('REVIEWED DRAFT', { timeout: 30_000 });
    return 'status strip = REVIEWED DRAFT';
  });

  // --- XML draft (only meaningful if sign-off passed) ---
  let xmlDetail = 'skipped: sign-off did not succeed';
  if (signOffOk) {
    await step('generate DDS XML draft (DRAFT_NOT_SUBMITTED)', async () => {
      await p.getByRole('tab', { name: 'Documents' }).click();
      const [xml] = await Promise.all([
        p.waitForEvent('download', { timeout: 120_000 }),
        p.getByRole('button', { name: 'Create and download XML' }).click(),
      ]);
      const name = xml.suggestedFilename() ?? '';
      xmlDetail = name;
      if (!name.includes('DRAFT_NOT_SUBMITTED')) throw new Error(`unexpected XML filename: ${name}`);
      const bytes = readFileSync((await xml.path())!);
      const text = bytes.toString('utf8');
      if (!text.includes('<')) throw new Error('XML content does not look like XML');
      return `${name} ${bytes.length} bytes`;
    });
  } else {
    steps.push({ step: 'generate DDS XML draft (DRAFT_NOT_SUBMITTED)', ok: false, detail: xmlDetail });
  }

  // --- Evidence change -> stale sign-off ---
  await step('evidence change invalidates sign-off (XML blocked)', async () => {
    await p.getByRole('tab', { name: 'Shipment details' }).click();
    await p.locator('#field-description input').fill('ENGINEERING TEST cocoa beans, revised');
    await p.getByRole('button', { name: 'Save details' }).click();
    await p.waitForTimeout(1500);
    await p.getByRole('tab', { name: 'Documents' }).click();
    await expect(p.getByRole('button', { name: 'Create and download XML' })).toBeDisabled({ timeout: 30_000 });
    await expect(p.locator('.badge', { hasText: 'Out of date' }).first()).toBeVisible({ timeout: 30_000 });
    return 'XML export disabled; Out of date badge shown';
  });

  // --- Re-openability: fresh context login sees the same case ---
  await step('fresh-context login sees the same case', async () => {
    const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const q = await second.newPage();
    await q.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await q.getByLabel('Email').fill(email);
    await q.getByLabel('Password').fill(password);
    await q.getByRole('button', { name: 'Sign in', exact: true }).click();
    await q.waitForURL('**/app', { timeout: 60_000 });
    await expect(q.getByRole('link', { name: CASE_REF })).toBeVisible({ timeout: 30_000 });
    await second.close();
    return 'case visible after fresh sign-in';
  });
} catch (e) {
  steps.push({ step: 'aborted', ok: false, detail: String(e instanceof Error ? e.message : e).slice(0, 800) });
  await p.screenshot({ path: 'docs/evidence/demo-validation-failure.png', fullPage: true }).catch(() => {});
} finally {
  save({ caseUrl });
  await browser.close();
  console.log(JSON.stringify({ done: true, passed: steps.filter((s) => s.ok).length, failed: steps.filter((s) => !s.ok).length }));
}
