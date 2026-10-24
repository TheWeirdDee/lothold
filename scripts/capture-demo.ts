// Captures the landing-page demonstration images from the running app using the labelled ENGINEERING fixtures.
// Refuses to run against anything but an engineering instance (LOTHOLD_INSTANCE=engineering, throwaway database).
//   node scripts/capture-demo.ts <baseUrl> <outDir>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8799';
const out = process.argv[3] ?? 'capture';
mkdirSync(out, { recursive: true });
const health = (await (await fetch(`${base}/api/health`)).json()) as { instance?: string };
if (health.instance !== 'engineering') {
  console.error('Refusing to run: not an engineering instance.');
  process.exit(2);
}
const b = await chromium.launch({ channel: 'chrome' });
// Viewport is 60 px taller than the image so the app's own top bar can be clipped off.
const page = await b.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const clip = { x: 0, y: 60, width: 1440, height: 900 };
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.goto(`${base}/register`);
await page.getByLabel('Your name').fill('Engineering Reviewer');
await page.getByLabel('Organisation').fill('ENGINEERING TEST ORG');
await page.getByLabel('Email').fill(`capture-${Date.now()}@example.test`);
await page.getByLabel('Password').fill('engineering-test-pw');
await page.getByRole('button', { name: 'Create workspace' }).click();
await page.waitForURL('**/app');
await page.getByLabel(/New case/).fill('ENG-DEMO-001');
await page.getByRole('button', { name: 'Create case' }).click();
await page.waitForURL('**/app/shipments/**');
await page.getByRole('tab', { name: 'Shipment details' }).click();
await page.locator('#field-activityType select').selectOption('IMPORT');
await page.locator('#field-hsCode input').fill('1801');
await page.locator('#field-description input').fill('ENGINEERING TEST cocoa beans');
await page.locator('#field-netMassValue input').fill('1000');
await page.locator('#field-operatorName input').fill('ENGINEERING TEST OPERATOR');
await page.locator('#field-countryOfActivity input').fill('BE');
await page.getByRole('button', { name: 'Save details' }).click();
await page.getByText(/Saved \d field/).waitFor();
for (const [tab, file, mime] of [
  ['Source lots', 'tests/fixtures/engineering/ENGINEERING_TEST_sources.csv', 'text/csv'],
  [/Plots/, 'tests/fixtures/engineering/ENGINEERING_TEST_plots.geojson', 'application/geo+json'],
] as const) {
  await page.getByRole('tab', { name: tab }).click();
  await page.locator('form.file-drop input[type=file]').first().setInputFiles(file);
  await page.locator('form.file-drop').first().getByRole('button', { name: 'Upload' }).click();
  await page.getByRole('button', { name: 'Preview and confirm' }).first().click();
  await page.getByRole('button', { name: /^Confirm/ }).first().click();
  await page.getByText('Confirmed as the active source').waitFor();
  void mime;
}
await page.waitForTimeout(6000);
await page.reload();
await page.getByRole('tab', { name: 'Findings' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/findings.png`, clip });
await page.getByRole('tab', { name: /Plots/ }).click();
await page.locator('.mapbox svg').first().waitFor();
await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((e) => e.textContent?.startsWith('ENG-PLOT-A'));
  if (h) window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 84 + 20);
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/land-evidence.png`, clip });
console.log('captured');
await b.close();
