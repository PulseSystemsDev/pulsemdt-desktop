import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'path';
import log from 'electron-log';
import store from './configStore';
import { resolveWindowBounds, getDisplayIdForWindow, constrainToDisplay } from './displayUtils';
import { OfflineMonitor } from './offlineMonitor';
import { ensureSignedIn } from './authManager';
import type { PanelId, WindowBounds } from './types';

interface PanelDef {
  path: string;
  title: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
}

const PANELS: Record<PanelId, PanelDef> = {
  dispatch:  { path: '/dashboard',                           title: 'PulseMDT · Dispatch',   defaultWidth: 1440, defaultHeight: 900,  minWidth: 900,  minHeight: 600 },
  map:       { path: '/dashboard?panel=map&standalone=1',    title: 'PulseMDT · Live Map',   defaultWidth: 1200, defaultHeight: 900,  minWidth: 600,  minHeight: 400 },
  mdt:       { path: '/dashboard/mdt',                       title: 'PulseMDT · MDT',        defaultWidth: 1280, defaultHeight: 860,  minWidth: 800,  minHeight: 500 },
  ems:       { path: '/dashboard/ems',                       title: 'PulseMDT · EMS',        defaultWidth: 1200, defaultHeight: 800,  minWidth: 800,  minHeight: 500 },
  cases:     { path: '/dashboard/cases',                     title: 'PulseMDT · Cases',      defaultWidth: 1280, defaultHeight: 860,  minWidth: 800,  minHeight: 500 },
  reports:   { path: '/dashboard/reports',                   title: 'PulseMDT · Reports',    defaultWidth: 1280, defaultHeight: 860,  minWidth: 800,  minHeight: 500 },
  courts:    { path: '/dashboard/courts',                    title: 'PulseMDT · Courts',     defaultWidth: 1280, defaultHeight: 860,  minWidth: 800,  minHeight: 500 },
  civilian:  { path: '/dashboard/civilian',                  title: 'PulseMDT · Civilian',   defaultWidth: 1280, defaultHeight: 860,  minWidth: 800,  minHeight: 500 },
  shifts:    { path: '/dashboard/shifts',                    title: 'PulseMDT · Shifts',     defaultWidth: 1280, defaultHeight: 860,  minWidth: 800,  minHeight: 500 },
  roster:    { path: '/dashboard/roster',                    title: 'PulseMDT · Roster',     defaultWidth: 1280, defaultHeight: 860,  minWidth: 800,  minHeight: 500 },
  codes:     { path: '/dashboard/codes',                     title: 'PulseMDT · Codes',      defaultWidth: 1280, defaultHeight: 860,  minWidth: 800,  minHeight: 500 },
  analytics: { path: '/dashboard/analytics',                 title: 'PulseMDT · Analytics',  defaultWidth: 1280, defaultHeight: 860,  minWidth: 800,  minHeight: 500 },
  admin:     { path: '/dashboard/admin',                     title: 'PulseMDT · Admin',      defaultWidth: 1280, defaultHeight: 860,  minWidth: 800,  minHeight: 500 },
};

const DEBOUNCE_MS = 600;

const TRUSTED_AUTH_ORIGINS = [
  process.env.PULSE_ACCOUNTS_ISSUER ? new URL(process.env.PULSE_ACCOUNTS_ISSUER).origin : 'https://accounts.pulsesystems.dev',
  'https://discord.com',
  'https://discordapp.com',
];

function isTrustedNavigationTarget(url: string, allowedOrigin: string): boolean {
  try {
    const origin = new URL(url).origin;
    return origin === allowedOrigin || TRUSTED_AUTH_ORIGINS.includes(origin);
  } catch {
    return false;
  }
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function openExternalSafely(value: string) {
  if (!isSafeExternalUrl(value)) {
    log.warn('[WindowManager] Blocked unsafe external URL:', value);
    return;
  }
  void shell.openExternal(value).catch(error => {
    log.warn('[WindowManager] Failed to open external URL:', error);
  });
}

export class WindowManager {
  private windows = new Map<PanelId, BrowserWindow>();
  private monitors = new Map<PanelId, OfflineMonitor>();
  private serverUrl: string;
  private isDev: boolean;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
    this.isDev = !app.isPackaged;
  }

  async init() {
    const openPanels = store.get('openPanels') as PanelId[];

    if (!openPanels.includes('dispatch')) openPanels.unshift('dispatch');

    for (const panelId of openPanels) {
      await this.openPanel(panelId, false);
    }

    screen.on('display-removed', (_e, removed) => {
      for (const [id, win] of this.windows) {
        if (win.isDestroyed()) continue;
        const [x, y] = win.getPosition();
        const displayId = getDisplayIdForWindow(x, y);
        if (displayId === removed.id) {
          log.info(`[WindowManager] Display ${removed.id} removed, moving ${id} to primary`);
          const primary = screen.getPrimaryDisplay().workArea;
          win.setPosition(primary.x + 50, primary.y + 50);
          this.saveLayout(id, win);
        }
      }
    });
  }

  async openPanel(panelId: PanelId, focus = true): Promise<BrowserWindow> {
    const existing = this.windows.get(panelId);
    if (existing && !existing.isDestroyed()) {
      if (focus) { existing.show(); existing.focus(); }
      return existing;
    }

    const def = PANELS[panelId];
    if (!def) {
      log.warn('[WindowManager] Unknown panel:', panelId);
      throw new Error(`Unknown panel: ${panelId}`);
    }

    const savedLayouts = store.get('windowLayouts') as Partial<Record<PanelId, WindowBounds>>;
    const bounds = resolveWindowBounds(savedLayouts[panelId], def.defaultWidth, def.defaultHeight);
    const constrained = constrainToDisplay(bounds.x, bounds.y, bounds.width, bounds.height);

    const win = new BrowserWindow({
      x: constrained.x,
      y: constrained.y,
      width: constrained.width,
      height: constrained.height,
      minWidth: def.minWidth,
      minHeight: def.minHeight,
      title: def.title,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#14151a',
        symbolColor: '#64748b',
        height: 36,
      },
      backgroundColor: '#14151a',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });

    const fullUrl = `${this.serverUrl}${def.path}`;
    log.info(`[WindowManager] Opening ${panelId} → ${fullUrl}`);

    const allowedOrigin = new URL(this.serverUrl).origin;
    win.webContents.setWindowOpenHandler(({ url }) => {
      log.info('[WindowManager] window-open request:', url);
      if (isTrustedNavigationTarget(url, allowedOrigin)) {
        void win.loadURL(url);
      } else if (isSafeExternalUrl(url)) {
        openExternalSafely(url);
      } else {
        log.warn('[WindowManager] Blocked invalid window URL:', url);
      }
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      const trusted = isTrustedNavigationTarget(url, allowedOrigin);
      log.info(`[WindowManager] will-navigate ${trusted ? '(in-window)' : '(-> external browser)'}:`, url);
      if (!trusted) {
        e.preventDefault();
        openExternalSafely(url);
      }
    });
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      log.info(`[Renderer:${panelId}] (${level})`, message, `${sourceId}:${line}`);
    });

    win.webContents.on('did-navigate', (_e, url) => {
      try {
        const target = new URL(url);
        if (target.origin === allowedOrigin && target.pathname === '/auth/signin') {
          void this.handleSignInRedirect(win, panelId, def.path);
        }
      } catch {
      }
    });

    const isTrustedPermissionRequest = (url: string, permission: string) => {
      try {
        return permission === 'notifications' && new URL(url).origin === allowedOrigin;
      } catch {
        return false;
      }
    };
    win.webContents.session.setPermissionCheckHandler((webContents, permission) => (
      !!webContents && isTrustedPermissionRequest(webContents.getURL(), permission)
    ));
    win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(isTrustedPermissionRequest(webContents.getURL(), permission));
    });

    const resourcesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(__dirname, '../../resources');
    win.loadFile(path.join(resourcesPath, 'splash.html'));
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => win.loadURL(fullUrl), 400);
    });

    win.once('ready-to-show', () => {
      win.show();
      if (this.isDev && panelId === 'dispatch') {
        win.webContents.openDevTools({ mode: 'detach' });
      }
    });

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => this.saveLayout(panelId, win), DEBOUNCE_MS);
    };
    win.on('moved',   scheduleSave);
    win.on('resized', scheduleSave);

    win.on('closed', () => {
      if (saveTimer) clearTimeout(saveTimer);
      this.saveLayout(panelId, win);
      this.monitors.get(panelId)?.destroy();
      this.monitors.delete(panelId);
      this.windows.delete(panelId);
      this.persistOpenPanels();
      this.broadcastToAll('panel:status-changed', this.getPanelStatus());
      log.info(`[WindowManager] Panel closed: ${panelId}`);
    });

    if (this.isDev) {
      win.webContents.on('context-menu', (_e, p) => {
        const { Menu, MenuItem } = require('electron');
        const menu = new Menu();
        menu.append(new MenuItem({ label: 'Inspect Element', click: () => win.webContents.inspectElement(p.x, p.y) }));
        menu.popup({ window: win });
      });
    }

    this.windows.set(panelId, win);
    this.persistOpenPanels();
    this.broadcastToAll('panel:status-changed', this.getPanelStatus());

    const monitor = new OfflineMonitor(win, this.serverUrl, def.path);
    this.monitors.set(panelId, monitor);

    return win;
  }

  private async handleSignInRedirect(win: BrowserWindow, panelId: PanelId, targetPath: string) {
    if (win.isDestroyed()) return;
    log.info(`[WindowManager] ${panelId} needs sign-in, starting device flow`);
    win.hide();
    const ok = await ensureSignedIn(this.serverUrl);
    if (win.isDestroyed()) return;
    if (ok) {
      win.show();
      win.loadURL(`${this.serverUrl}${targetPath}`);
    } else {
      log.warn(`[WindowManager] Sign-in was cancelled or failed; closing ${panelId}`);
      win.close();
    }
  }

  closePanel(panelId: PanelId) {
    const win = this.windows.get(panelId);
    if (win && !win.isDestroyed()) win.close();
  }

  focusMain() {
    const win = this.windows.get('dispatch');
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  }

  broadcastToAll(channel: string, ...args: any[]) {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channel, ...args);
    }
  }

  dispatchToMain(channel: string, ...args: any[]) {
    const win = this.windows.get('dispatch');
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }

  getAllWindows(): Map<PanelId, BrowserWindow> {
    return this.windows;
  }

  getPanelStatus(): Record<PanelId, boolean> {
    const status = {} as Record<PanelId, boolean>;
    for (const id of Object.keys(PANELS) as PanelId[]) {
      const win = this.windows.get(id);
      status[id] = !!(win && !win.isDestroyed());
    }
    return status;
  }

  private saveLayout(panelId: PanelId, win: BrowserWindow) {
    if (win.isDestroyed()) return;
    try {
      const [x, y] = win.getPosition();
      const [w, h] = win.getSize();
      const displayId = getDisplayIdForWindow(x, y);
      const layouts = { ...store.get('windowLayouts') };
      layouts[panelId] = { x, y, width: w, height: h, displayId };
      store.set('windowLayouts', layouts);
    } catch (err) {
      log.warn('[WindowManager] Failed to save layout for', panelId, err);
    }
  }

  private persistOpenPanels() {
    const open = (Array.from(this.windows.keys()) as PanelId[]).filter(id => {
      const w = this.windows.get(id);
      return w && !w.isDestroyed();
    });
    store.set('openPanels', open.length ? open : ['dispatch']);
  }
}
