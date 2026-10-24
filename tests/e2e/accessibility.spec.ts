// ENGINEERING ACCESSIBILITY TESTS against a throwaway database (all records are test fixtures).
// Automated only: axe-core WCAG 2.2 A/AA rules plus scripted keyboard, focus and live-region checks. This is not a
// screen-reader test; see docs/ACCESSIBILITY.md for what still needs a human with NVDA/VoiceOver.
import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const CSV = 'supplier_id,supplier_name,source_lot_ref,source_lot_declared_quantity,allocated_quantity,quantity_unit,producer_country,plot_refs\nENG-S,ENGINEERING TEST,ENG-L,1000,600,kg,CI,ENG-P1;ENG-P2\n';
const PLOTS = JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { plot_ref: 'ENG-P1', ProducerCountry: 'CI' }, geometry: { type: 'Polygon', coordinates: [[[-7.56, 6.24], [-7.55, 6.24], [-7.55, 6.25], [-7.56, 6.25], [-7.56, 6.24]]] } },
] });

test.use({ reducedMotion: 'reduce' });

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = r.violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, summary.join('\n')).toEqual([]);
}
async function register(page: Page, org: string) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Engineering Reviewer');
  await page.getByLabel('Organisation').fill(org);
  await page.getByLabel('Email').fill(`a11y-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`);
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

for (const width of [1440, 390]) {
  test(`axe: public pages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/method', '/inspect', '/verify', '/login', '/register']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await axe(page, `${path} @${width}`);
    }
  });
}

test('axe: authenticated workspace, every shipment tab and the review dialog', async ({ page }) => {
  await register(page, 'ENG A11Y AXE');
  await axe(page, 'empty workspace');
  await page.getByLabel(/New case/).fill('ENG-A11Y-AXE');
  await page.getByRole('button', { name: 'Create case' }).click();
  await page.waitForURL('**/app/shipments/**');
  await axe(page, 'new shipment');
  await page.getByRole('tab', { name: 'Source lots' }).click();
  await uploadConfirm(page, 'ENGINEERING_TEST_sources.csv', CSV, 'text/csv');
  await page.getByRole('tab', { name: /Plots/ }).click();
  await uploadConfirm(page, 'ENGINEERING_TEST_plots.geojson', PLOTS, 'application/geo+json');
  await expect(page.locator('.mapbox svg').first()).toBeVisible({ timeout: 30_000 });
  for (const name of ['Findings', 'Shipment details', 'Source lots', /Plots/, 'Allocation', 'Documents', 'Activity']) {
    await page.getByRole('tab', { name }).click();
    await page.waitForLoadState('networkidle');
    await axe(page, `tab ${name}`);
  }
  await page.getByRole('tab', { name: 'Findings' }).click();
  await page.getByRole('button', { name: 'Record investigation' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await axe(page, 'review dialog');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Escape');
  for (const name of ['Findings', 'Shipment details', 'Source lots', /Plots/, 'Allocation', 'Documents', 'Activity']) {
    await page.getByRole('tab', { name }).click();
    await page.waitForLoadState('networkidle');
    await axe(page, `tab ${name} @390`);
  }
});

test('keyboard only: register, create a case, switch tabs, open and close a dialog', async ({ page }) => {
  await page.goto('/register');
  const type = async (label: string | RegExp, text: string) => {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      if (await page.getByLabel(label).evaluate((e) => e === document.activeElement)) { await page.keyboard.type(text); return; }
    }
    throw new Error(`could not reach ${label} by Tab`);
  };
  await type('Your name', 'Engineering Keyboard');
  await type('Organisation', 'ENG A11Y KEYBOARD');
  await type('Email', `kbd-${Date.now()}@example.test`);
  await type('Password', 'engineering-test-pw');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/app');

  // Client-side navigation moves focus to the new page's main content, so the next Tab continues inside it.
  await expect(page.locator('#main')).toBeFocused();
  await type(/New case/, 'ENG-A11Y-KBD');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/app/shipments/**');

  // Tabs: one Tab stop; arrows move between tabs and activate them; Home/End jump.
  const tabs = page.getByRole('tab');
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Shipment details' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Shipment details' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Findings' })).toBeFocused();
  expect(await tabs.evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length)).toBe(1);
  const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return `${s.outlineStyle} ${s.outlineWidth}`; });
  expect(outline).not.toMatch(/^none|0px$/);

  // Dialog: Enter opens it, focus moves inside, Escape closes it and focus returns to the trigger.
  await page.getByRole('tab', { name: 'Source lots' }).click();
  await uploadConfirm(page, 'ENGINEERING_TEST_sources.csv', CSV, 'text/csv');
  await page.getByRole('tab', { name: /Plots/ }).click();
  await uploadConfirm(page, 'ENGINEERING_TEST_plots.geojson', PLOTS, 'application/geo+json');
  await page.getByRole('tab', { name: 'Findings' }).click();
  const trigger = page.getByRole('button', { name: 'Record investigation' }).first();
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg).toHaveAccessibleName(/.+/);
  expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await dlg.evaluate((d) => d.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('errors and status changes are announced through live regions', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.test');
  await page.getByLabel('Password').fill('wrong-password-xyz');
  await page.getByRole('button', { name: /Sign in/ }).click();
  await expect(page.getByRole('alert')).toContainText(/incorrect/i);

  await register(page, 'ENG A11Y LIVE');
  await page.getByLabel(/New case/).fill('ENG-A11Y-LIVE');
  await page.getByRole('button', { name: 'Create case' }).click();
  await page.waitForURL('**/app/shipments/**');
  await page.getByRole('tab', { name: /Plots/ }).click();
  await page.locator('form.file-drop input[type=file]').first().setInputFiles({ name: 'broken.geojson', mimeType: 'application/geo+json', buffer: Buffer.from('{"type":"FeatureCollection"') });
  await page.locator('form.file-drop').first().getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Not valid JSON/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Shipment details' }).click();
  await page.locator('#field-hsCode input').fill('1801');
  await page.getByRole('button', { name: 'Save details' }).click();
  // The confirmation is inside a polite live region (role=status or aria-live).
  const saved = page.getByText(/Saved 1 field/);
  await expect(saved).toBeVisible();
  expect(await saved.evaluate((e) => !!e.closest('[role="status"], [aria-live="polite"], [aria-live="assertive"], [role="alert"]'))).toBe(true);
});
