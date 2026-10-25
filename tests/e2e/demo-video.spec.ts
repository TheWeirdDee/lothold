// Real bundled recordings; no API or mocked video success.
import { test, expect } from '@playwright/test';
for (const width of [1440, 390]) {
  test(`bundled walkthrough playback without API at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/**', (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: 'No API' }));
    const heavy: string[] = [];
    page.on('request', (r) => { if (r.url().endsWith('.webm')) heavy.push(r.url()); });
    await page.goto('/'); await page.locator('.demo').scrollIntoViewIfNeeded();
    const preview = page.getByLabel('LotHold short walkthrough');
    await expect(preview).toHaveAttribute('preload', 'none'); expect(heavy).toEqual([]);
    expect(await preview.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await page.getByRole('button', { name: 'Play muted preview' }).click();
    await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(.5);
    expect(await preview.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
    await page.getByRole('button', { name: 'Pause preview' }).click();
    expect(await preview.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await page.getByRole('button', { name: 'Play full walkthrough' }).click();
    const full = page.getByLabel('LotHold full walkthrough');
    await expect.poll(() => full.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(.5);
    await expect.poll(() => full.evaluate((v: HTMLVideoElement) => v.textTracks[0]?.cues?.length ?? 0)).toBeGreaterThan(0);
    expect(await full.evaluate((v: HTMLVideoElement) => v.controls && v.textTracks[0]?.mode === 'showing')).toBe(true);
    await full.evaluate((v: HTMLVideoElement) => v.requestFullscreen());
    expect(await full.evaluate((v) => document.fullscreenElement === v)).toBe(true);
    await page.evaluate(() => document.exitFullscreen());
    await full.focus(); await page.keyboard.press('Space');
    expect(await full.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    const box = (await full.boundingBox())!; expect(box.width).toBeLessThanOrEqual(width);
    await page.getByText('Read the walkthrough transcript', { exact: true }).click();
    await expect(page.locator('.walkthrough-transcript')).toContainText('out of date');
  });
}
