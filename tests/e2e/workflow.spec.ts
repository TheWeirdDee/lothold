// ENGINEERING BROWSER TESTS against a throwaway database. All shipments, suppliers and plots are test fixtures;
// plot geometries are coordinate probe boxes, not farms.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const CSV = 'supplier_id,supplier_name,source_lot_ref,source_lot_declared_quantity,allocated_quantity,quantity_unit,producer_country,plot_refs\nENG-S,ENGINEERING TEST,ENG-L,1000,600,kg,CI,ENG-P1;ENG-P2\n';
const SIGNAL = [[[-7.56, 6.24], [-7.55, 6.24], [-7.55, 6.25], [-7.56, 6.25], [-7.56, 6.24]]];
const CLEAR = [[[-7.205, 5.745], [-7.195, 5.745], [-7.195, 5.755], [-7.205, 5.755], [-7.205, 5.745]]];
const plots = (withP2: boolean) =>
  JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { plot_ref: 'ENG-P1', ProducerCountry: 'CI' }, geometry: { type: 'Polygon', coordinates: SIGNAL } },
    ...(withP2 ? [{ type: 'Feature', properties: { plot_ref: 'ENG-P2', ProducerCountry: 'CI' }, geometry: { type: 'Polygon', coordinates: CLEAR } }] : []),
  ] });

const errors: string[] = [];
function watch(page: Page) {
  // Browsers log deliberate 4xx refusals as console errors; 5xx responses and script errors still fail the run.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
}
async function register(page: Page, org: string) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Engineering Reviewer');
  await page.getByLabel('Organisation').fill(org);
  await page.getByLabel('Email').fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`);
  await page.getByLabel('Password').fill('engineering-test-pw');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL('**/app');
}
async function uploadConfirm(page: Page, name: string, content: string, mime: string) {
  await page.locator('form.file-drop input[type=file]').first().setInputFiles({ name, mimeType: mime, buffer: Buffer.from(content) });
  await page.locator('form.file-drop').first().getByRole('button', { name: 'Upload' }).click();
  await page.getByRole('button', { name: 'Preview and confirm' }).first().click();
  await page.getByRole('button', { name: /^Confirm/ }).first().click();
  await expect(page.getByText('Confirmed as the active source')).toBeVisible();
}

test.beforeEach(({ page }) => watch(page));
test.afterAll(() => expect(errors, errors.join('\n')).toEqual([]));

test('fresh visit: public pages work, links resolve, workspace starts honestly empty', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hold a cocoa shipment');
  await expect(page.getByText('LotHold ships no sample shipments')).toBeVisible();
  await page.locator('img').first().scrollIntoViewIfNeeded();
  const broken = await page.locator('img').evaluateAll((imgs) => imgs.filter((i) => !(i as HTMLImageElement).complete || (i as HTMLImageElement).naturalWidth === 0).map((i) => (i as HTMLImageElement).src));
  expect(broken).toEqual([]);
  for (const path of ['/', '/inspect', '/method', '/verify', '/login', '/register']) {
    await page.goto(path);
    const hrefs = await page.locator('a[href^="/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));
    for (const h of new Set(hrefs)) expect((await request.get(h)).status(), `${path} -> ${h}`).toBe(200);
  }
  await register(page, 'ENG E2E EMPTY');
  await expect(page.getByRole('heading', { name: 'No shipments yet' })).toBeVisible();
  await expect(page.getByText('LotHold includes no sample shipments')).toBeVisible();
  const unknownApi = await request.get('/api/does-not-exist');
  expect(unknownApi.status()).toBe(404);
  expect((await unknownApi.json()).error.code).toBe('not_found');
  const tpl = await request.get('/api/templates/sources.csv');
  expect(await tpl.text()).toBe('supplier_id,supplier_name,source_lot_ref,source_lot_declared_quantity,allocated_quantity,quantity_unit,producer_country,plot_refs\n');
});

test('full review: upload, error correction, source navigation, evidence, export, sign-off, invalidation, persistence', async ({ page }) => {
  await register(page, 'ENG E2E FLOW');
  await page.getByLabel(/New case/).fill('ENG-E2E-FLOW');
  await page.getByRole('button', { name: 'Create case' }).click();
  await page.waitForURL('**/app/shipments/**');
  await expect(page.getByRole('heading', { name: 'Nothing uploaded yet' })).toBeVisible();

  await page.getByRole('tab', { name: 'Shipment details' }).click();
  await page.locator('#field-activityType select').selectOption('IMPORT');
  await page.locator('#field-hsCode input').fill('1801');
  await page.locator('#field-description input').fill('ENGINEERING TEST cocoa beans');
  await page.locator('#field-netMassValue input').fill('600');
  await page.locator('#field-operatorName input').fill('ENGINEERING TEST OPERATOR');
  await page.locator('#field-operatorEori input').fill('BE0000000000');
  await page.locator('#field-countryOfActivity input').fill('BE');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText(/Saved 7 field/)).toBeVisible();

  await page.getByRole('tab', { name: 'Source lots' }).click();
  await uploadConfirm(page, 'ENGINEERING_TEST_sources.csv', CSV, 'text/csv');
  await expect(page.locator('#src-row-2')).toContainText('ENG-L');

  // Error correction: a malformed GeoJSON is rejected with an actionable message.
  await page.getByRole('tab', { name: /Plots/ }).click();
  await page.locator('form.file-drop input[type=file]').first().setInputFiles({ name: 'broken.geojson', mimeType: 'application/geo+json', buffer: Buffer.from('{"type":"FeatureCollection"') });
  await page.locator('form.file-drop').first().getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText(/could not be used: Not valid JSON/)).toBeVisible();
  await uploadConfirm(page, 'ENGINEERING_TEST_plots_v1.geojson', plots(false), 'application/geo+json');

  // Findings link to the exact source row.
  await page.getByRole('tab', { name: 'Findings' }).click();
  await expect(page.locator('.status-strip')).toContainText('HOLD');
  await expect(page.getByText('Plot ENG-P2 has no geometry')).toBeVisible();
  await page.getByRole('button', { name: /Show source: .*row 2 · plot_refs/ }).click();
  await expect(page).toHaveURL(/tab=sources/);
  await expect(page.locator('#src-row-2')).toHaveClass(/highlight/);

  // Supply the missing boundary; the land-change signal on ENG-P1 remains.
  await page.getByRole('tab', { name: /Plots/ }).click();
  await uploadConfirm(page, 'ENGINEERING_TEST_plots_v2.geojson', plots(true), 'application/geo+json');
  await expect(page.locator('.mapbox svg').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('This plot has a land-change signal after the cut-off. Request review.')).toBeVisible();
  await page.getByRole('button', { name: /ENG-P2/ }).click();
  await expect(page.locator('.badge', { hasText: 'No post-2020 loss observed' }).first()).toBeVisible();

  // Export the supplier request.
  await page.getByRole('tab', { name: 'Documents' }).click();
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Create and download PDF' }).first().click()]);
  expect(pdf.suggestedFilename()).toMatch(/evidence-request.*\.pdf$/);
  const pdfBytes = readFileSync(await pdf.path());
  expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByRole('button', { name: 'Create and download XML' })).toBeDisabled();

  // Record an investigation with evidence (rationale alone is refused by the server).
  await page.getByRole('tab', { name: 'Findings' }).click();
  await page.getByRole('button', { name: 'Record investigation' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/Investigated: supporting evidence/).check();
  await dlg.getByLabel(/^Rationale/).fill('Engineering test: evidence file explains the recorded change in detail.');
  await dlg.getByRole('button', { name: 'Record decision' }).click();
  await expect(dlg.getByText(/Attach the supporting evidence/)).toBeVisible();
  await dlg.locator('#evidence-file').setInputFiles({ name: 'ENGINEERING_TEST_evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('ENGINEERING TEST evidence - not a real record') });
  await dlg.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByText('Review decision recorded.')).toBeVisible();

  await page.getByRole('tab', { name: 'Allocation' }).click();
  await page.getByRole('button', { name: 'Reserve allocations in ledger' }).click();
  await expect(page.getByRole('button', { name: 'Allocations reserved' })).toBeVisible();

  await page.getByRole('tab', { name: 'Findings' }).click();
  await expect(page.locator('.status-strip')).toContainText('READY FOR SIGN-OFF');
  await page.getByRole('button', { name: /Sign off snapshot/ }).click();
  await expect(page.locator('.status-strip')).toContainText('REVIEWED DRAFT');

  await page.getByRole('tab', { name: 'Documents' }).click();
  const [xml] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Create and download XML' }).click()]);
  expect(xml.suggestedFilename()).toMatch(/DDS-V3_DRAFT_NOT_SUBMITTED.*\.xml$/);
  await expect(page.getByText(/XSD valid · base64 round-trip ok · 2 producer/)).toBeVisible();

  // Persistence after refresh and re-navigation.
  await page.reload();
  await expect(page.locator('.status-strip')).toContainText('REVIEWED DRAFT');

  // A source change invalidates the sign-off and marks documents out of date.
  await page.getByRole('tab', { name: 'Shipment details' }).click();
  await page.locator('#field-description input').fill('ENGINEERING TEST cocoa beans, revised');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.locator('.status-strip')).toContainText('Sign-off out of date');
  await page.getByRole('tab', { name: 'Documents' }).click();
  await expect(page.locator('.badge', { hasText: 'Out of date' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create and download XML' })).toBeDisabled();

  await page.goto('/app');
  await expect(page.getByRole('link', { name: 'ENG-E2E-FLOW' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toContainText('Sign-off out of date');
});

test('public forest inspection shows real pixels, dates and caveats', async ({ page }) => {
  await page.goto('/inspect');
  await page.getByLabel('Longitude (centre)').fill('-7.2');
  await page.getByLabel('Latitude (centre)').fill('5.75');
  await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.locator('.badge', { hasText: 'No post-2020 loss observed' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/not evidence that the plot is deforestation-free/)).toBeVisible();
  await expect(page.locator('.mapbox svg')).toBeVisible();
  await page.getByLabel('Longitude (centre)').fill('12');
  await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.locator('.badge', { hasText: 'Outside dataset coverage' })).toBeVisible({ timeout: 30_000 });
});

test('mobile layout and keyboard access', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Method & sources' }).click();
  await expect(page).toHaveURL(/\/method/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  // Keyboard: the skip link is the first focus stop and moves focus to main content.
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
  expect(focused.length).toBeGreaterThan(0);
  // Touch targets on key controls are at least 40px tall.
  const h = await page.getByRole('link', { name: 'Create a workspace' }).evaluate((e) => e.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(40);
});
