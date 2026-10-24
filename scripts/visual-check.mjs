// Visual check: captures the landing page at given widths and reports console errors, horizontal overflow and
// clipped elements (masked by body overflow-x: hidden).  node scripts/visual-check.mjs <baseUrl> <outDir> <width...>
import { chromium } from '@playwright/test';
const [base, out, ...widths] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome' });
const errors = [];
for (const w of widths.map(Number)) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  p.on('console', (m) => m.type() === 'error' && errors.push(`${w}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${w}: ${e.message}`));
  await p.goto(base + '/');
  await p.waitForTimeout(1600);
  await p.screenshot({ path: `${out}/landing-${w}-fold.png` });
  // trigger reveals and the live reading by scrolling through
  for (let y = 0; y < 12000; y += 600) { await p.evaluate((yy) => window.scrollTo(0, yy), y); await p.waitForTimeout(120); }
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: `${out}/landing-${w}-full.png`, fullPage: true });
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  if (sw > w) errors.push(`${w}: horizontal overflow ${sw}`);
  // Elements whose right edge passes the viewport (masked by body overflow-x: hidden), excluding intentional scrollers.
  const clipped = await p.evaluate((vw) => [...document.querySelectorAll('main *')].filter((e) => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.right <= vw + 1) return false;
    for (let a = e.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return a.tagName === 'BODY' || a.tagName === 'HTML'; }
    return true;
  }).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} right=${Math.round(e.getBoundingClientRect().right)}`), w);
  if (clipped.length) errors.push(`${w}: clipped ${clipped.join(' | ')}`);
  await p.close();
}
console.log(JSON.stringify(errors));
await b.close();
