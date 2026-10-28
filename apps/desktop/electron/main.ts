import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, Menu, app, net, protocol } from 'electron';
import { resolveArtifact } from '@moyu/core';
import { MoyuApp } from './app';

const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5273';
const isDev = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL);
let moyuApp: MoyuApp | undefined;
let mainWindow: BrowserWindow | undefined;

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
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#05060a',
    roundedCorners: true,
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', async () => {
    win.show();
    const capturePath = process.env.MOYU_CAPTURE;
    if (capturePath) {
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
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  const dataDir = process.env.MOYU_DATA_DIR ?? path.join(app.getPath('userData'), 'moyu');
  moyuApp = new MoyuApp(dataDir, app.getVersion());
  moyuApp.start();

  const workspaceDir = moyuApp.store.getSettings().cloud.workspaceDir;
  protocol.handle('moyu-asset', async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = resolveArtifact(workspaceDir, relative);
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });

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

app.on('before-quit', () => {
  moyuApp?.dispose();
});

process.on('uncaughtException', (error) => {
  console.error('[moyu] uncaught', error);
});