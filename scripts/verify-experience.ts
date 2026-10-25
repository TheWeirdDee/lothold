// Captures actual responsive pages. Run against an owned engineering server.
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
const base = process.argv[2] ?? 'http://127.0.0.1:8805';
let owned: ChildProcess | null = null;
if (!process.argv[2]) {
  owned = spawn(process.execPath, ['scripts/e2e-server.ts'], { env: { ...process.env, E2E_PORT: '8805' }, windowsHide: true, stdio: 'ignore' });
  for(let i=0;i<180;i++) { try { if((await fetch(base+'/api/ready?strict=1')).ok) break; } catch {} await new Promise(r=>setTimeout(r,300)); }
}

const health = await (await fetch(base + '/api/health')).json() as { instance?: string };
if (health.instance !== 'engineering') throw new Error('An isolated engineering instance is required.');
const out = 'docs/screenshots/experience'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const errors: string[] = [], findings: object[] = [];
try {
  for (const width of [320, 360, 390, 480, 768, 900, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 500 || (r.status() >= 400 && !r.url().includes('/api/'))) errors.push(`${width}: ${r.status()} ${new URL(r.url()).pathname}`); });
    await page.goto(base + '/'); await page.locator('.hero').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}/landing-${width}-fold.png` });
    for (const img of await page.locator('img').all()) { await img.scrollIntoViewIfNeeded(); await img.evaluate((i) => (i as HTMLImageElement).decode()); }
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({ path: `${out}/landing-${width}-full.png`, fullPage: true });
    const layout = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, sections: [...document.querySelectorAll('.landing > section')].map((e) => ({ heading: e.querySelector('h1,h2')?.textContent, height: Math.round(e.getBoundingClientRect().height) })), clipped: [...document.querySelectorAll('.landing h1,.landing h2,.landing h3,.landing p,.landing button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).map((e) => e.textContent?.slice(0, 60)) }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(width); expect(layout.clipped).toEqual([]);
    findings.push({ width, ...layout });
    if ([390, 768, 1440].includes(width)) {
      for (const path of ['/docs', '/method', '/login', '/verify']) {
        await page.goto(base + path); await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `${out}/${path.slice(1)}-${width}-full.png`, fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }
    if (width === 390) { await page.goto(base + '/'); await page.getByRole('button', { name: 'Open navigation' }).click(); await page.screenshot({ path: `${out}/navigation-390.png` }); }
    await page.close();
  }
  const zoom = await browser.newPage({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await zoom.goto(base + '/');
  await zoom.addStyleTag({ content: 'p { line-height: 1.8 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }' });
  for(const img of await zoom.locator('img').all()) { await img.scrollIntoViewIfNeeded(); await img.evaluate((i)=>(i as HTMLImageElement).decode()); }
  await zoom.evaluate(()=>window.scrollTo(0,0));
  await zoom.screenshot({ path: `${out}/landing-200-percent-equivalent-text-spacing.png`, fullPage: true });
  expect(await zoom.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(720);
  await zoom.close();
  const videoPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await videoPage.goto(base + '/');
  await videoPage.getByRole('button', {name: 'Play full walkthrough'}).click();
  const video = videoPage.getByLabel('LotHold full walkthrough');
  const record = JSON.parse(readFileSync('docs/evidence/experience-recording.json','utf8'));
  const pdfTime = record.chapters.find((c: any)=>c.text.startsWith('Open the generated')).seconds + 1;
  await video.evaluate(async (v: HTMLVideoElement, time: number) => { if(v.readyState < 1) await new Promise(r=>v.addEventListener('loadedmetadata',r,{once:true})); v.pause(); await new Promise<void>(r=>{v.addEventListener('seeked',()=>r(),{once:true});v.currentTime=time;}); }, pdfTime);
  await videoPage.locator('.demo .video-frame').screenshot({path: `${out}/recorded-pdf-frame.png`});
  await videoPage.close();
  writeFileSync('docs/evidence/experience-layout.json', JSON.stringify({ checkedAt: new Date().toISOString(), reducedMotion: true, note: '720 CSS px @2x is a 1440px display at 200% zoom equivalent; not a manual browser zoom audit.', errors, findings }, null, 2) + '\n');
  expect(errors).toEqual([]);
} finally { await browser.close(); owned?.kill(); }
