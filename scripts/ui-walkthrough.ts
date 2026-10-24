// ENGINEERING UI WALKTHROUGH: drives the real UI against a throwaway database with engineering fixtures,
// captures screenshots at several widths and reports console errors. Not operational data.
//   node scripts/ui-walkthrough.ts <baseUrl> <outDir>
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8799';
const out = process.argv[3] ?? 'shots';
mkdirSync(out, { recursive: true });
// Engineering fixtures must never reach an operational workspace.
const health = (await (await fetch(`${base}/api/health`)).json()) as { instance?: string };
if (health.instance !== 'engineering') {
  console.error(`Refusing to run: ${base} is not an engineering instance (start it with LOTHOLD_INSTANCE=engineering and a throwaway DATABASE_PATH).`);
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome' });
const consoleErrors: string[] = [];
const watch = (p: Page) => {
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${p.url()} :: ${m.text()}`); });
  p.on('pageerror', (e) => consoleErrors.push(`${p.url()} :: pageerror ${e.message}`));
  p.on('response', (r) => { if (r.status() >= 500) consoleErrors.push(`${r.url()} :: HTTP ${r.status()}`); });
};
const shot = async (p: Page, name: string) => p.screenshot({ path: `${out}/${name}.png`, fullPage: true });

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
watch(page);
for (const w of [360, 768, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(base + '/');
  await shot(page, `landing-${w}`);
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(base + '/register');
await page.getByLabel('Your name').fill('Engineering Reviewer');
await page.getByLabel('Organisation').fill('ENGINEERING TEST ORG');
await page.getByLabel('Email').fill(`ui-${Date.now()}@example.test`);
await page.getByLabel('Password').fill('engineering-test-pw');
await page.getByRole('button', { name: 'Create workspace' }).click();
await page.waitForURL('**/app');
await shot(page, 'empty-workspace-1440');
await page.setViewportSize({ width: 390, height: 844 });
await shot(page, 'empty-workspace-390');
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByLabel(/New case/).fill('ENG-UI-001');
await page.getByRole('button', { name: 'Create case' }).click();
await page.waitForURL('**/app/shipments/**');
await shot(page, 'desk-empty-1440');

// Details
await page.getByRole('tab', { name: 'Shipment details' }).click();
await page.getByLabel(/^Activity type/).selectOption('IMPORT');
await page.getByLabel(/^HS code/).fill('1801');
await page.getByLabel(/^Description of goods/).fill('ENGINEERING TEST cocoa beans');
await page.locator('#field-netMassValue input').fill('1000');
await page.getByLabel(/^Operator name/).fill('ENGINEERING TEST OPERATOR');
await page.getByLabel(/^Country of activity/).fill('BE');
await page.getByRole('button', { name: 'Save details' }).click();
await page.getByText(/Saved \d field/).waitFor();

// Sources
await page.getByRole('tab', { name: 'Source lots' }).click();
await page.locator('input[type=file]').setInputFiles('tests/fixtures/engineering/ENGINEERING_TEST_sources.csv');
await page.getByRole('button', { name: 'Upload' }).click();
await page.getByRole('button', { name: 'Preview and confirm' }).click();
await shot(page, 'sources-preview-1440');
await page.getByRole('button', { name: /Confirm/ }).first().click();
await page.getByText('Active source table').waitFor();
await shot(page, 'sources-1440');

// Plots
await page.getByRole('tab', { name: /Plots/ }).click();
await page.locator('input[type=file]').setInputFiles('tests/fixtures/engineering/ENGINEERING_TEST_plots.geojson');
await page.getByRole('button', { name: 'Upload' }).click();
await page.getByRole('button', { name: 'Preview and confirm' }).click();
await page.getByRole('button', { name: /Confirm/ }).first().click();
await page.getByText('Active plot file').waitFor();
await page.waitForTimeout(6000);
await page.reload();
await shot(page, 'plots-1440');
await page.setViewportSize({ width: 390, height: 844 });
await shot(page, 'plots-390');
await page.setViewportSize({ width: 1440, height: 900 });

await page.getByRole('tab', { name: 'Findings' }).click();
await shot(page, 'findings-1440');
// Cropped desk view (no browser chrome) for documentation and the landing page.
await page.setViewportSize({ width: 1440, height: 1000 });
await page.screenshot({ path: `${out}/desk-crop-1440.png`, clip: { x: 0, y: 56, width: 1440, height: 944 } });
for (const w of [360, 768, 1024]) {
  await page.setViewportSize({ width: w, height: 900 });
  await shot(page, `findings-${w}`);
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('tab', { name: 'Allocation' }).click();
await shot(page, 'allocation-1440');
await page.getByRole('tab', { name: 'Documents' }).click();
await shot(page, 'documents-1440');
await page.getByRole('tab', { name: 'Activity' }).click();
await shot(page, 'activity-1440');

await page.goto(base + '/inspect');
await page.getByLabel('Longitude (centre)').fill('-7.555');
await page.getByLabel('Latitude (centre)').fill('6.245');
await page.getByRole('button', { name: 'Run analysis' }).click();
await page.getByText('Sampled', { exact: true }).waitFor({ timeout: 30000 });
await shot(page, 'inspect-1440');
await page.setViewportSize({ width: 360, height: 800 });
await shot(page, 'inspect-360');
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(base + '/method');
await shot(page, 'method-1440');
await page.goto(base + '/verify');
await page.waitForTimeout(1500);
await shot(page, 'verify-1440');

// Horizontal overflow check at each width on key pages.
const overflow: string[] = [];
for (const path of ['/', '/inspect', '/method', '/verify', '/app']) {
  for (const w of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(base + path);
    await page.waitForTimeout(300);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > w) overflow.push(`${path} @${w}: scrollWidth ${sw}`);
  }
}
console.log(JSON.stringify({ consoleErrors, overflow }, null, 1));
await browser.close();
