import { test, expect } from '@playwright/test';

test('cold-start recovery preserves blurred, unsaved form values and never replays a mutation', async ({ page }) => {
  let ready = false, mutations = 0, navigations = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++; });
  await page.route('**/api/**', (r) => {
    if (r.request().method() === 'POST') mutations++;
    if (r.request().url().endsWith('/api/ready')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ready }) });
    return r.fulfill({ status: ready ? 200 : 503, contentType: ready ? 'application/json' : 'text/plain', body: ready ? '{"user":null}' : 'Waking up' });
  });
  await page.goto('/register');
  await expect(page.getByText('The LotHold server is starting up.', { exact: true })).toBeVisible();
  await page.getByLabel('Your name').fill('ENGINEERING UNSAVED NAME');
  await page.getByLabel('Organisation').fill('ENGINEERING UNSAVED ORG');
  await page.locator('h1').click(); // blurred values are still unsaved data
  const settledNavigations = navigations;
  ready = true;
  await expect(page.getByText('The LotHold server is ready.', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel('Your name')).toHaveValue('ENGINEERING UNSAVED NAME');
  await expect(page.getByLabel('Organisation')).toHaveValue('ENGINEERING UNSAVED ORG');
  expect(navigations).toBe(settledNavigations); expect(mutations).toBe(0);
});

for (const state of ['failed','unavailable'] as const) {
 test(`readiness ${state} preserves inputs and recovers only after explicit retry`, async ({page}) => {
  let recovered=false;
  await page.route('**/api/**',r=>{
   if(r.request().url().endsWith('/api/ready'))return r.fulfill({status:recovered?200:503,contentType:'application/json',body:JSON.stringify({ready:recovered,state:recovered?'ready':state})});
   return r.fulfill({status:recovered?200:503,contentType:recovered?'application/json':'text/plain',body:recovered?'{"user":null}':'Starting'});
  });
  await page.goto('/register');
  await page.getByLabel('Your name').fill('ENGINEERING UNSAVED');
  await expect(page.getByText(state==='failed'?'Server readiness failed.':'The service is still unavailable.',{exact:true})).toBeVisible();
  recovered=true;
  await page.getByRole('button',{name:'Retry connection',exact:true}).click();
  await expect(page.getByText('The LotHold server is ready.',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue('ENGINEERING UNSAVED');
 });
}

test('mobile menu traps focus, closes on Escape and selection, restores focus and unlocks scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/');
  const open = page.getByRole('button', { name: 'Open navigation' });
  await open.click();
  const menu = page.getByRole('dialog', { name: 'LotHold / Explore' });
  await expect(menu).toBeVisible();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  for (let i = 0; i < 14; i++) await page.keyboard.press('Tab');
  expect(await menu.evaluate((el) => el.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
  await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible(); await expect(open).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await open.click(); await menu.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/); await expect(menu).not.toBeVisible();
  await page.locator('.mobile-contents summary').click();
  await page.getByRole('navigation', { name: 'Mobile page contents' }).getByRole('link', { name: 'CSV fields and units' }).click();
  await expect(page).toHaveURL(/#csv$/);
});

test('FAQ is keyboard accessible and marketing footer is route-specific', async ({ page }) => {
  await page.goto('/');
  const q = page.getByRole('button', { name: 'Does it certify EUDR compliance?' });
  await q.focus(); await page.keyboard.press('Enter'); await expect(q).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('region', { name: 'Does it certify EUDR compliance?' })).toContainText('never submits');
  await page.keyboard.press('Space'); await expect(q).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.footer')).toHaveCount(1);
  for (const path of ['/login', '/register', '/app', '/docs', '/method']) { await page.goto(path); await expect(page.locator('.footer')).toHaveCount(0); }
});

test('all informational content remains available without API; live status stays honest', async ({ page, request }) => {
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: 'No API' }));
  for (const path of ['/', '/docs', '/method', '/verify', '/test-kit', '/inspect']) {
    await page.goto(path); await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.backend-notice')).toHaveCount(0);
  }
  await page.goto('/method#versions');
  await expect(page.locator('#versions')).toContainText('forest-analysis/');
  await expect(page.locator('#sources')).toContainText('CC BY 4.0');
  await expect(page.locator('.service-status')).toContainText('Live service status unavailable');
  await page.goto('/verify'); await expect(page.getByText('Live count unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read from contract' })).toBeDisabled();
  expect((await request.get('/templates/sources.csv')).status()).toBe(200);
  await page.goto('/inspect');
  await expect(page.getByRole('status').filter({ hasText: 'Analysis needs the LotHold server' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run analysis' })).toBeDisabled();
  await page.goto('/app'); await expect(page.getByRole('heading', { name: 'Your session could not be checked' })).toBeVisible();
});

test('same account from a second, isolated browser context reaches the same organisation and case; sign-out ends the session', async ({ browser }) => {
  const email = `xdevice-${Date.now()}@example.test`;
  const password = 'engineering-test-pw';
  // Device A: register, create a case, sign out through the interface.
  const a = await browser.newContext();
  const pa = await a.newPage();
  await pa.goto('/register');
  await pa.getByLabel('Your name').fill('Engineering Reviewer A');
  await pa.getByLabel('Organisation').fill('ENGINEERING TEST ORG (cross-device)');
  await pa.getByLabel('Email').fill(email);
  await pa.getByLabel('Password').fill(password);
  await pa.getByRole('button', { name: 'Create workspace' }).click();
  await pa.waitForURL('**/app');
  await pa.getByLabel(/New case/).fill('ENG-XDEVICE-001');
  await pa.getByRole('button', { name: 'Create case' }).click();
  await pa.waitForURL('**/app/shipments/**');
  const caseUrl = new URL(pa.url()).pathname;
  await pa.goto('/app');
  await pa.getByRole('button', { name: 'Sign out' }).click();
  await pa.waitForURL((u) => new URL(u).pathname === '/');
  expect((await (await pa.request.get('/api/auth/me')).json()).user).toBeNull();
  // Nothing authoritative is kept in browser storage.
  expect(await pa.evaluate(() => Object.keys(localStorage).filter((k) => /user|session|case|ship/i.test(k)))).toEqual([]);
  await a.close();

  // Device B: a fresh context with no shared cookies or storage signs in and sees the same case.
  const b = await browser.newContext();
  const pb = await b.newPage();
  await pb.goto('/login');
  await pb.getByLabel('Email').fill(email);
  await pb.getByLabel('Password').fill(password);
  await pb.getByRole('button', { name: 'Sign in' }).click();
  await pb.waitForURL('**/app');
  await expect(pb.getByRole('link', { name: 'ENG-XDEVICE-001' })).toBeVisible();
  await pb.goto(caseUrl);
  await expect(pb.getByRole('heading', { name: 'ENG-XDEVICE-001' })).toBeVisible();
  await b.close();

  // A different organisation cannot open it.
  const c = await browser.newContext();
  const pc = await c.newPage();
  await pc.goto('/register');
  await pc.getByLabel('Your name').fill('Engineering Reviewer C');
  await pc.getByLabel('Organisation').fill('ENGINEERING TEST ORG (other)');
  await pc.getByLabel('Email').fill(`other-${Date.now()}@example.test`);
  await pc.getByLabel('Password').fill(password);
  await pc.getByRole('button', { name: 'Create workspace' }).click();
  await pc.waitForURL('**/app');
  const id = caseUrl.split('/').pop();
  expect((await pc.request.get(`/api/shipments/${id}`)).status()).toBe(404);
  await c.close();
});
