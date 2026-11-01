/** 从桌面构建产物里提取 Grok 静态头像数据（window.GROK_GEO.shapes）到 apps/mobile。 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false });
    const dist = path.join(__dirname, '..', 'apps', 'desktop', 'dist', 'index.html');
    await win.loadFile(dist);
    await new Promise((r) => setTimeout(r, 4000));
    const data = await win.webContents.executeJavaScript('JSON.stringify(window.GROK_GEO && window.GROK_GEO.shapes || null)');
    if (!data || data === 'null') throw new Error('GROK_GEO.shapes 未找到');
    const out = path.join(__dirname, '..', 'apps', 'mobile', 'src', 'assets', 'grok-portraits.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
    console.log('dumped', data.length, 'bytes ->', out);
  } catch (error) {
    console.error('dump failed:', error.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
