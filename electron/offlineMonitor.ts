import { BrowserWindow, net } from 'electron';
import path from 'path';
import log from 'electron-log';

const PING_INTERVAL = 3000;
const OFFLINE_CODES = new Set([-2, -6, -7, -100, -101, -102, -105, -106, -109, -118, -137, -138]);

export class OfflineMonitor {
  private win: BrowserWindow;
  private serverUrl: string;
  private panelPath: string;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private isOffline = false;

  constructor(win: BrowserWindow, serverUrl: string, panelPath: string) {
    this.win = win;
    this.serverUrl = serverUrl;
    this.panelPath = panelPath;
    this.attach();
  }

  private attach() {
    this.win.webContents.on('did-fail-load', (_e, code, _desc, url) => {
      if (code === -3) return;
      if (!url || !url.startsWith(this.serverUrl)) return;
      log.warn(`[OfflineMonitor] Load failed (code ${code}) for ${url}`);
      if (!this.isOffline) this.goOffline();
    });

    this.win.webContents.on('did-navigate', (_e, url) => {
      if (url.includes('/offline.html')) return;
      if (this.isOffline) {
        log.info('[OfflineMonitor] Navigation succeeded, came back online');
        this.goOnline();
      }
    });
  }

  private goOffline() {
    if (this.win.isDestroyed()) return;
    this.isOffline = true;
    const { app } = require('electron');
    const resourcesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(__dirname, '../../resources');
    const offlinePage = path.join(resourcesPath, 'offline.html');
    this.win.loadFile(offlinePage, {
      query: { url: `${this.serverUrl}${this.panelPath}` },
    });
    this.startPing();
  }

  private goOnline() {
    this.isOffline = false;
    this.stopPing();
  }

  private startPing() {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private async ping() {
    if (!this.isOffline || this.win.isDestroyed()) { this.stopPing(); return; }
    try {
      const res = await net.fetch(`${this.serverUrl}/api/health`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok || res.status < 500) {
        log.info('[OfflineMonitor] Server is back, reloading panel');
        this.stopPing();
        this.isOffline = false;
        this.win.loadURL(`${this.serverUrl}${this.panelPath}`);
      }
    } catch {
    }
  }

  destroy() {
    this.stopPing();
  }
}
