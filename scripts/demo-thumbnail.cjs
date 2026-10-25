// Native SVG layout with a real captured application frame; no generated/mock UI.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
(async () => {
  fs.mkdirSync('docs/demo/qa', { recursive: true });
  const ffmpeg = execFileSync('python', ['-c', 'from scripts.demo_render_tools import executable; print(executable("ffmpeg"))'], { encoding: 'utf8' }).trim();
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-ss', '18', '-i', 'docs/demo/raw/scene-04-analysis.webm', '-frames:v', '1', 'docs/demo/qa/thumbnail-source.png']);
  const screenshot = fs.readFileSync('docs/demo/qa/thumbnail-source.png').toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs><clipPath id="screen"><rect x="850" y="132" width="1000" height="760" rx="22"/></clipPath></defs>
  <rect width="1920" height="1080" fill="#101b17"/>
  <rect x="76" y="92" width="12" height="70" rx="6" fill="#74bf8c"/>
  <text x="114" y="147" fill="#f5f3e9" font-family="Segoe UI,Arial" font-size="62" font-weight="700">LotHold</text>
  <text x="86" y="305" fill="#92cba4" font-family="Segoe UI,Arial" font-size="25" letter-spacing="5">COCOA SHIPMENT REVIEW</text>
  <text x="80" y="435" fill="#f5f3e9" font-family="Segoe UI,Arial" font-size="91" font-weight="700">Scattered files.</text>
  <text x="80" y="550" fill="#f5f3e9" font-family="Segoe UI,Arial" font-size="91" font-weight="700">Clearer evidence.</text>
  <text x="86" y="657" fill="#bac9c0" font-family="Segoe UI,Arial" font-size="34">Upload. Investigate. Review.</text>
  <rect x="86" y="755" width="355" height="66" rx="33" fill="#75bd8c"/>
  <text x="263" y="798" fill="#102219" text-anchor="middle" font-family="Segoe UI,Arial" font-size="28" font-weight="700">REAL PRODUCT DEMO</text>
  <rect x="844" y="126" width="1012" height="772" rx="26" fill="#3f594a"/>
  <image href="data:image/png;base64,${screenshot}" x="850" y="132" width="1000" height="760" preserveAspectRatio="xMidYMid slice" clip-path="url(#screen)"/>
  <text x="86" y="982" fill="#9aafa2" font-family="Segoe UI,Arial" font-size="25">ENGINEERING TEST RECORDS · NO REAL SHIPMENT OR REGULATORY SUBMISSION</text>
  </svg>`;
  fs.writeFileSync('docs/demo/thumbnail.svg', svg);
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.setContent(`<body style="margin:0">${svg}</body>`);
    await page.screenshot({ path: 'docs/demo/thumbnail.png' });
  } finally { await browser.close(); }
  console.log('Saved docs/demo/thumbnail.png and editable native SVG.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
