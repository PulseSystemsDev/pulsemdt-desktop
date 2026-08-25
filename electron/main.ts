import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { net } from 'electron';
import log from 'electron-log';
import store from './configStore';
import { WindowManager } from './windowManager';
import { setupTray, destroyTray } from './tray';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { setupUpdater } from './updater';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let windowManager: WindowManager;

function normalizeServerUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Server URL must use HTTP or HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Server URL must not contain embedded credentials.');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Server URL must not contain a query string or fragment.');
  }
  return parsed.toString().replace(/\/$/, '');
}

if (!app.isDefaultProtocolClient('pulsemdt')) {
  app.setAsDefaultProtocolClient('pulsemdt');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find(a => a.startsWith('pulsemdt://'));
    if (url) handleDeepLink(url);
    windowManager?.focusMain();
  });
}

app.whenReady().then(async () => {
  log.info('App ready, version', app.getVersion());

  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(__dirname, '../../resources');
  protocol.handle('app', (request) => {
    try {
      const parsed = new URL(request.url);
      const requestedPath = decodeURIComponent(`${parsed.hostname}${parsed.pathname}`).replace(/^[/\\]+/, '');
      const resolvedPath = path.resolve(resourcesPath, requestedPath);
      const relativePath = path.relative(path.resolve(resourcesPath), resolvedPath);
      if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(resolvedPath).toString());
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });

  const serverUrl = store.get('serverUrl');

  if (!serverUrl) {
    openSetupWindow();
  } else {
    try {
      await launchApp(normalizeServerUrl(serverUrl));
    } catch (error) {
      log.warn('Stored server URL is invalid; reopening setup.', error);
      openSetupWindow();
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  windowManager?.focusMain();
});

app.on('open-url', (_e, url) => {
  handleDeepLink(url);
});

app.on('will-quit', () => {
  unregisterShortcuts();
});

ipcMain.handle('setup:test', async (_e, url: string) => {
  try {
    const clean = normalizeServerUrl(url);
    const res = await net.fetch(`${clean}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `Server responded with status ${res.status}. Is this a PulseMDT server?` };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes('ECONNREFUSED'))
      return { ok: false, error: 'Connection refused. Make sure the server is running.' };
    if (msg.includes('ENOTFOUND') || msg.includes('ENOENT'))
      return { ok: false, error: 'Host not found. Check the URL and your network connection.' };
    if (msg.includes('timeout') || msg.includes('abort'))
      return { ok: false, error: 'Connection timed out. The server did not respond in 5 seconds.' };
    return { ok: false, error: msg };
  }
});

ipcMain.handle('setup:save', async (_e, url: string) => {
  const clean = normalizeServerUrl(url);
  store.set('serverUrl', clean);
  log.info('Server URL saved:', clean);
  const setupWin = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Setup'));
  await launchApp(clean);
  setupWin?.close();
});

ipcMain.on('panel:open', (_e, panelId: string) => {
  windowManager?.openPanel(panelId as any);
});

ipcMain.on('panel:close', (_e, panelId: string) => {
  windowManager?.closePanel(panelId as any);
});

ipcMain.handle('panel:getStatus', () => {
  return windowManager?.getPanelStatus() ?? {};
});

ipcMain.on('panel:openMulti', (_e, panelIds: string[]) => {
  for (const id of panelIds) {
    windowManager?.openPanel(id as any);
  }
});

ipcMain.on('duty:toggle', () => {
  windowManager?.dispatchToMain('duty:toggle');
});

let updaterStarted = false;

async function launchApp(serverUrl: string) {
  log.info('Launching app, server:', serverUrl);

  if (windowManager) {
    destroyTray();
    unregisterShortcuts();
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.getTitle().includes('Setup')) w.close();
    }
  }

  windowManager = new WindowManager(serverUrl);
  await windowManager.init();

  setupTray(windowManager, () => openSetupWindow());
  registerShortcuts(windowManager);
  if (!updaterStarted) {
    setupUpdater(windowManager);
    updaterStarted = true;
  }
}

function openSetupWindow() {
  const win = new BrowserWindow({
    width: 560,
    height: 600,
    resizable: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#14151a',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-setup.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(__dirname, '../../resources');
  win.loadFile(path.join(resourcesPath, 'setup.html'));
  if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' });

  win.setTitle('PulseMDT Setup');
  win.on('closed', () => {
    if (!store.get('serverUrl') && BrowserWindow.getAllWindows().length === 0) {
      app.quit();
    }
  });
}

function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/open')) {
      const panel = parsed.searchParams.get('panel');
      if (panel) windowManager?.openPanel(panel as any);
    }
  } catch {
    log.warn('Invalid deep-link:', url);
  }
}

export { windowManager };
