// ENGINEERING CHECK: loads every public and signed-in page at several widths on a throwaway engineering server and
// reports page overflow, content cut off at the viewport edge, sideways-scrolling regions and squeezed table cells.
// Screenshots of flagged pages go to the output directory.   node scripts/responsive-sweep.ts <outDir>
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'sweep';
mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:8792';
const server = spawn(process.execPath, ['scripts/e2e-server.ts'], { env: { ...process.env, E2E_PORT: '8792' }, stdio: 'ignore' });
for (let i = 0; i < 180; i++) { try { if ((await fetch(base + '/api/ready')).status === 200) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ reducedMotion: 'reduce' });
const p = await ctx.newPage();
await p.goto(base + '/register');
await p.getByLabel('Your name').fill('Engineering Reviewer');
await p.getByLabel('Organisation').fill('ENGINEERING TEST ORG (sweep)');
await p.getByLabel('Email').fill(`sweep-${Date.now()}@example.test`);
await p.getByLabel('Password').fill('engineering-test-pw');
await p.getByRole('button', { name: 'Create workspace' }).click();
await p.waitForURL('**/app');
await p.getByLabel(/New case/).fill('ENG-SWEEP-001');
await p.getByRole('button', { name: 'Create case' }).click();
await p.waitForURL('**/app/shipments/**');
const caseUrl = new URL(p.url()).pathname;
for (const [tab, file] of [['Source lots', 'tests/fixtures/engineering/ENGINEERING_TEST_sources.csv'], [/Plots/, 'tests/fixtures/engineering/ENGINEERING_TEST_plots.geojson']] as const) {
  await p.getByRole('tab', { name: tab }).click();
  await p.locator('[role=tabpanel] form.file-drop input[type=file]').first().setInputFiles(file);
  await p.locator('[role=tabpanel] form.file-drop').first().getByRole('button', { name: 'Upload' }).click();
  await p.getByRole('button', { name: 'Preview and confirm' }).first().click();
  await p.getByRole('button', { name: /^Confirm/ }).first().click();
  await p.getByText('Confirmed as the active source').waitFor();
}
await p.waitForTimeout(4000);
const pages = ['/', '/docs', '/method', '/verify', '/inspect', '/test-kit', '/login', '/register', '/app', ...['review', 'details', 'sources', 'plots', 'allocation', 'documents', 'activity'].map((t) => `${caseUrl}?tab=${t}`)];
const report: { w: number; path: string; issues: string[] }[] = [];
for (const w of [320, 360, 390, 480, 768, 900, 1024, 1280, 1440, 1920]) {
  await p.setViewportSize({ width: w, height: 900 });
  for (const path of pages) {
    const authed = path.startsWith('/app');
    const pg = authed ? p : await browser.newPage({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
    await pg.goto(base + path);
    await pg.waitForTimeout(500);
    const issues = await pg.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const visible = (e: Element) => { const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && e.getBoundingClientRect().width > 0; };
      const scroller = (e: Element) => { for (let x = e.parentElement; x; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === 'auto' || o === 'scroll') return x as HTMLElement; } return null; };
      const found: string[] = [];
      if (document.documentElement.scrollWidth > vw + 1) found.push(`page overflow ${document.documentElement.scrollWidth}>${vw}`);
      for (const e of document.querySelectorAll('main *')) {
        if (!visible(e) || e.closest('svg') || e.closest('.trace-scroll')) continue;
        const rect = e.getBoundingClientRect();
        const sc = scroller(e);
        if (!sc && rect.right > vw + 1 && e.children.length === 0 && (e.textContent ?? '').trim()) found.push(`cut off: ${e.tagName} "${(e.textContent ?? '').trim().slice(0, 40)}"`);
        if (sc && sc.scrollWidth > sc.clientWidth + 1 && !sc.closest('.trace-scroll')) found.push(`sideways scroll (${sc.className || sc.tagName}) ${sc.scrollWidth}>${sc.clientWidth}`);
        if ((e.tagName === 'TD' || e.tagName === 'TH') && getComputedStyle(e).display === 'table-cell' && rect.width < 64 && (e.textContent ?? '').trim().length > 12) found.push(`squeezed cell ${Math.round(rect.width)}px "${(e.textContent ?? '').trim().slice(0, 30)}"`);
      }
      return [...new Set(found)].slice(0, 8);
    });
    if (path === '/verify' && [390, 1440].includes(w)) await pg.screenshot({ path: `${out}/registry-${w}.png`, fullPage: true });
    if (issues.length) {
      report.push({ w, path: path.replace(/[0-9a-f-]{36}/, ':id'), issues });
      await pg.screenshot({ path: `${out}/${w}${path.replace(/[0-9a-f-]{36}/, 'case').replace(/[/?=]/g, '_')}.png`, fullPage: true });
    }
    if (!authed) await pg.close();
  }
}
writeFileSync(`${out}/report.json`, JSON.stringify({ widths: [320,360,390,480,768,900,1024,1280,1440,1920], pageCount: pages.length, flagged: report }, null, 2));
console.log(JSON.stringify(report, null, 1));
console.log(`${report.length} flagged page/width combinations`);
await browser.close();
server.kill();
