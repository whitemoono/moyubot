import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, Menu, app, net, protocol } from 'electron';
import { resolveArtifact } from '@moyu/core';
import { MoyuApp } from './app';
import { startRendererServer } from './renderer-server';

const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5273';
const isDev = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL);
let moyuApp: MoyuApp | undefined;
let mainWindow: BrowserWindow | undefined;
let rendererServer: Awaited<ReturnType<typeof startRendererServer>> | undefined;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'moyu-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1460,
    height: 950,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#111111',
    roundedCorners: true,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, process.platform === 'win32' ? 'icon.ico' : 'icon.png')
      : path.join(app.getAppPath(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.setMenu(null);
  win.once('ready-to-show', async () => {
    win.show();
    const capturePath = process.env.MOYU_CAPTURE;
    if (capturePath) {
      // UI 验证钩子：MOYU_CAPTURE_CLICK 里放分号分隔的 aria-label/文本，截图前依次点击。
      const clicks = (process.env.MOYU_CAPTURE_CLICK ?? '').split(';').map((item) => item.trim()).filter(Boolean);
      for (const target of clicks) {
        await win.webContents.executeJavaScript(`(() => {
          const byLabel = document.querySelector('[aria-label="${target}"]');
          if (byLabel) { byLabel.click(); return true; }
          const byText = [...document.querySelectorAll('button,[role="menuitem"]')].find((el) => (el.textContent || '').includes('${target}'));
          if (byText) { byText.click(); return true; }
          return false;
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const image = await win.webContents.capturePage();
      fs.mkdirSync(path.dirname(capturePath), { recursive: true });
      fs.writeFileSync(capturePath, image.toPNG());
      console.log(`[moyu] captured ${capturePath}`);
      setTimeout(() => app.quit(), 300);
    }
  });
  win.on('closed', () => {
    mainWindow = undefined;
  });

  if (isDev) {
    void win.loadURL(DEV_URL);
    win.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  } else {
    void win.loadURL(rendererServer!.url);
  }
  return win;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  const dataDir = process.env.MOYU_DATA_DIR ?? path.join(app.getPath('userData'), 'moyu');
  moyuApp = new MoyuApp(dataDir, app.getVersion(), { localDirectory: path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(app.getAppPath(), '../..'), 'workspace') });
  moyuApp.start();

  const workspaceDir = moyuApp.store.getSettings().cloud.workspaceDir;
  protocol.handle('moyu-asset', async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = moyuApp?.resolveWorkspaceArtifact(relative);
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });

  if (!isDev) rendererServer = await startRendererServer(path.join(__dirname, '../dist'));
  mainWindow = createWindow();
  moyuApp.setWindow(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      moyuApp?.setWindow(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let desktopCleaned = false;
app.on('before-quit', (event) => {
  if (desktopCleaned || !moyuApp) return;
  event.preventDefault();
  moyuApp.dispose();
  void moyuApp.desktop.dispose().catch(() => {
    // Recovery record blocks automation on next launch until revocation succeeds.
    console.error('[moyu] desktop control cleanup deferred until next launch');
  }).finally(() => { rendererServer?.close(); desktopCleaned = true; app.quit(); });
});

process.on('uncaughtException', (error) => {
  moyuApp?.diagnostics.record({ source: '应用异常', message: error.message, detail: error.stack });
  console.error('[moyu] uncaught', error);
});
