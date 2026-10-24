// ENGINEERING TESTS for the landing demo video in its configured states. Each state runs on its own throwaway
// server. The clip played here is generated during the test (an animated "ENGINEERING TEST CLIP" card recorded by
// Playwright); it is not the LotHold demo and is never shipped. Video, caption and YouTube requests are answered
// inside the browser, so no external service is contacted.
import { test, expect, chromium, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CAPTIONS = 'WEBVTT\n\n00:00.000 --> 00:10.000\nENGINEERING TEST CAPTION\n';
let clip: Buffer;
const servers: ChildProcess[] = [];

async function startServer(port: number, env: Record<string, string>) {
  const child = spawn(process.execPath, ['scripts/e2e-server.ts'], { env: { ...process.env, ...env, E2E_PORT: String(port) }, stdio: 'ignore' });
  servers.push(child);
  for (let i = 0; i < 180; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/ready`)).status === 200) return `http://127.0.0.1:${port}`;
    } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server on ${port} did not become ready`);
}

test.beforeAll(async () => {
  // Record a short labelled test clip (WebM/VP8) with Playwright's own recorder.
  const dir = mkdtempSync(join(tmpdir(), 'lothold-clip-'));
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, recordVideo: { dir, size: { width: 640, height: 360 } } });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:0;background:#0c0e0d;color:#edeae1;font:600 28px system-ui;display:grid;place-items:center;height:100vh">
    <div style="text-align:center">ENGINEERING TEST CLIP<br><small style="font-size:16px">not the LotHold demo</small><div id="t" style="font:16px monospace;margin-top:12px"></div></div>
    <script>let n=0;setInterval(()=>{document.getElementById('t').textContent='frame '+(n++)},100)</script></body>`);
  await p.waitForTimeout(3000);
  await ctx.close();
  await browser.close();
  clip = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('.webm'))!));
});
test.afterAll(() => servers.forEach((s) => s.kill()));

async function serveClip(page: Page) {
  const hits = { video: 0, captions: 0 };
  await page.route('**/media/ENGINEERING_TEST_clip.webm', (r) => { hits.video++; return r.fulfill({ status: 200, contentType: 'video/webm', body: clip }); });
  await page.route('**/media/ENGINEERING_TEST_captions.vtt', (r) => { hits.captions++; return r.fulfill({ status: 200, contentType: 'text/vtt', body: CAPTIONS }); });
  return hits;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`hosted video file plays with native controls and captions at ${viewport.width}px`, async ({ page }) => {
    const base = await startServer(8796 + (viewport.width === 390 ? 10 : 0), {
      DEMO_VIDEO_URL: '/media/ENGINEERING_TEST_clip.webm',
      DEMO_VIDEO_CAPTIONS: '/media/ENGINEERING_TEST_captions.vtt',
    });
    await page.setViewportSize(viewport);
    const hits = await serveClip(page);
    await page.goto(base + '/');
    const video = page.locator('.demo video');
    await expect(video).toBeVisible();
    // Nothing heavy is fetched and nothing plays until the visitor asks.
    expect(await video.evaluate((v: HTMLVideoElement) => ({ autoplay: v.autoplay, preload: v.preload, paused: v.paused, controls: v.controls }))).toEqual({ autoplay: false, preload: 'none', paused: true, controls: true });
    expect(hits.video).toBe(0);
    // Responsive 16:9 frame inside the viewport.
    const box = (await page.locator('.demo .video-frame').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);
    // Keyboard: focus the native player and press Space, as a visitor can; playback starts and time advances.
    await video.scrollIntoViewIfNeeded();
    await video.focus();
    await page.keyboard.press('Space');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(0.5);
    expect(hits.video).toBeGreaterThan(0);
    // Captions load and show.
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.textTracks[0]?.mode)).toBe('showing');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.textTracks[0]?.cues?.length ?? 0)).toBeGreaterThan(0);
    // Fullscreen is available through the native controls (not disabled).
    expect(await video.evaluate((v: HTMLVideoElement) => document.fullscreenEnabled && !v.hasAttribute('controlslist'))).toBe(true);
    await expect(page.locator('.demo-note')).toContainText('engineering test records');
  });
}

test('YouTube link: privacy-enhanced player loads only after pressing play, with fullscreen allowed', async ({ page }) => {
  const base = await startServer(8795, { DEMO_VIDEO_URL: 'https://youtu.be/engTest0001' });
  const external: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith(base)) external.push(r.url()); });
  await page.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub player</title><p>engineering stub</p>' }));
  const res = await page.goto(base + '/');
  expect(res!.headers()['content-security-policy']).toContain('frame-src https://www.youtube-nocookie.com');
  const play = page.getByRole('button', { name: 'Play demo video' });
  await expect(play).toBeVisible();
  await expect(page.locator('#demo-provider')).toContainText('YouTube');
  expect(external.filter((u) => u.includes('youtube'))).toEqual([]);
  await expect(page.locator('.demo iframe')).toHaveCount(0);
  // Keyboard activation.
  await play.focus();
  await page.keyboard.press('Enter');
  const frame = page.locator('.demo iframe');
  await expect(frame).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/engTest0001\?autoplay=1/);
  await expect(frame).toHaveAttribute('title', 'LotHold demo video');
  await expect(frame).toHaveAttribute('allowfullscreen', '');
  expect(await frame.getAttribute('allow')).toContain('fullscreen');
  await expect(frame).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const box = (await page.locator('.demo .video-frame').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(390);
  expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);
});
