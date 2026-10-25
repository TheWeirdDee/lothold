// Play the complete final MP4 at 1x in Chrome, checking errors and frame progression.
const { chromium } = require('@playwright/test');
const { createServer } = require('node:http');
const fs = require('node:fs');
(async () => {
  const size = fs.statSync('lothold-demo.mp4').size;
  const server = createServer((req, res) => {
    if (req.url !== '/video.mp4') {
      res.setHeader('content-type', 'text/html');
      return res.end('<body style="margin:0;background:black"><video controls src="/video.mp4" style="width:100vw;height:100vh"></video></body>');
    }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(range ? 206 : 200, {
      'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': end - start + 1,
      ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {})
    });
    fs.createReadStream('lothold-demo.mp4', { start, end }).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('video').evaluate(v => v.play());
    const samples = [];
    const began = Date.now();
    for (;;) {
      const s = await page.locator('video').evaluate(v => ({ t: v.currentTime, duration: v.duration, ended: v.ended, error: v.error?.code || null, rate: v.playbackRate, frames: v.getVideoPlaybackQuality().totalVideoFrames, dropped: v.getVideoPlaybackQuality().droppedVideoFrames }));
      samples.push(s);
      if (s.error || errors.length) throw Error('Video playback error');
      if (s.ended) break;
      if (Date.now() - began > 250000) throw Error('Video did not finish normally');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    fs.writeFileSync('docs/demo/PLAYBACK_QA.json', JSON.stringify({ checkedAt: new Date().toISOString(), browser: 'Chrome, complete 1x playback', errors, samples, passed: true }, null, 2) + '\n');
    console.log('Complete 1x Chrome playback passed.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
