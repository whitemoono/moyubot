const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { once } = require('node:events');
const { chromium } = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server = require('../moyubot-film/serve.cjs');
let browser;
(async () => {
  const out = path.join(__dirname, 'output');
  fs.mkdirSync(out, { recursive: true });
  server.listen(0, 'localhost');
  await once(server, 'listening');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  await page.goto(`http://localhost:${server.address().port}/media/instabox-cover/cover.html`);
  await page.waitForFunction(() => window.COVER_READY || window.COVER_ERROR);
  const error = await page.evaluate(() => window.COVER_ERROR);
  if (error) throw new Error(error);

  const jobs = [
    ['InstaBox-4c8g-Cover-1920x1200.png', 1200],
    ['InstaBox-4c8g-Cover-1920x1080.png', 1080],
  ];
  for (const [name, height] of jobs) {
    const data = await page.evaluate(({ height }) => cover.render(height, 1).toDataURL('image/png').split(',')[1], { height });
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'));
  }
  // 站内缩略图（列表页约 320px 宽，这里出 960x600 检查可读性）
  const jpg = await page.evaluate(() => cover.jpeg(960, 600, 0.9).split(',')[1]);
  fs.writeFileSync(path.join(out, 'InstaBox-4c8g-960x600.jpg'), Buffer.from(jpg, 'base64'));
  const thumb = await page.evaluate(() => cover.jpeg(320, 200, 0.92).split(',')[1]);
  fs.writeFileSync(path.join(out, 'thumbnail-320x200.jpg'), Buffer.from(thumb, 'base64'));

  await browser.close();
  server.close();
  console.log(out);
})().catch(async (e) => { console.error(e); await browser?.close(); server.close(); process.exitCode = 1; });