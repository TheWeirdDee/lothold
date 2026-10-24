// Developer helper: full-page screenshot of one URL at one width.  node scripts/shot.ts <url> <width> <out.png>
import { chromium } from '@playwright/test';
const [url, width, out] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: Number(width), height: 900 } });
await p.goto(url!);
await p.waitForLoadState('networkidle');
await p.screenshot({ path: out!, fullPage: true });
await b.close();
