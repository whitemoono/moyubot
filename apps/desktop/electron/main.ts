import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, Menu, app, dialog, net, protocol, shell } from 'electron';
import { resolveArtifact } from '@moyu/core';
import { MoyuApp } from './app';
import { startRendererServer } from './renderer-server';
import { resolveDataDir } from './data-dir';

const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5273';
const isDev = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL);
let moyuApp: MoyuApp | undefined;
let mainWindow: BrowserWindow | undefined;
let rendererServer: Awaited<ReturnType<typeof startRendererServer>> | undefined;

// 云电桌面走 noVNC 的 WebSocket（wss://<port>-<id>.e2b.app/websockify）。系统代理
// （常见 127.0.0.1:7890）通常不转发 WebSocket 升级，接上就整块黑屏。这里让云电脑
// 域名绕过代理直连；失败时 Chromium 仍会回退到系统代理规则。
app.commandLine.appendSwitch(
  'proxy-bypass-list',
  ['<local>', '*.e2b.app', '*.e2b.dev', '*.instabox.sh', '*.e2b.com'].join(';'),
);

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
  // 外部链接（target="_blank" / window.open）一律交给系统浏览器，应用内不弹新窗口。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.setMenu(null);
  // 正式版窗口标题固定为产品名；开发态保留 "MoyuBot Dev" 以便和已安装版本区分。
  win.on('page-title-updated', (event) => event.preventDefault());
  win.setTitle(isDev ? 'MoyuBot Dev' : 'MoyuBot');
  // 兜底：若首个绘制迟迟不来（渲染慢/JS 报错），也把窗口显示出来，避免"进程在但没窗口"。
  const showFallback = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      console.warn('[moyu] ready-to-show timed out, forcing window show');
      win.show();
      if (isDev) win.webContents.openDevTools({ mode: 'detach' });
    }
  }, 6000);
  win.once('ready-to-show', async () => {
    clearTimeout(showFallback);
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
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[moyu] page failed to load: ${code} ${desc} ${url}`);
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  });
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
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

  const dataDir = resolveDataDir();
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
}).catch((error) => {
  console.error('[moyu] startup failed:', error);
  dialog.showErrorBox('MoyuBot 启动失败', String((error && error.stack) || error));
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let desktopCleaned = false;
app.on('before-quit', (event) => {
  if (desktopCleaned || !moyuApp) return;
  event.preventDefault();
  // Suspend the cloud sandbox before the host is disposed, so turning the app off
  // doesn't leave an E2B/InstaBox machine running (and billing). Best-effort with a
  // short timeout — never block quitting for long.
  const suspend = (async () => {
    try {
      const status = moyuApp!.cloud?.status();
      if (status && (status.state === 'ready' || status.state === 'busy')) {
        await Promise.race([
          moyuApp!.cloud.suspend('应用退出'),
          new Promise((resolve) => setTimeout(resolve, 8000)),
        ]);
      }
    } catch (error) {
      console.error('[moyu] suspend on quit failed:', (error as Error).message);
    }
  })();
  void suspend.catch(() => {}).finally(() => {
    moyuApp!.dispose();
    void moyuApp!.desktop.dispose().catch(() => {
      // Recovery record blocks automation on next launch until revocation succeeds.
      console.error('[moyu] desktop control cleanup deferred until next launch');
    }).finally(() => { rendererServer?.close(); desktopCleaned = true; app.quit(); });
  });
});

process.on('uncaughtException', (error) => {
  moyuApp?.diagnostics.record({ source: '应用异常', message: error.message, detail: error.stack });
  console.error('[moyu] uncaught', error);
});
