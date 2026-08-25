import log from 'electron-log';
import type { WindowManager } from './windowManager';

export function setupUpdater(wm: WindowManager) {
  const { app } = require('electron');
  if (!app.isPackaged) {
    log.info('[Updater] Skipping auto-update in development');
    return;
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('[Updater] Checking for update...');
  });

  autoUpdater.on('update-available', (info: { version: string }) => {
    log.info('[Updater] Update available:', info.version);
    wm.broadcastToAll('update:available', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[Updater] App is up to date');
  });

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    log.info(`[Updater] Download progress: ${Math.round(progress.percent)}%`);
    wm.broadcastToAll('update:progress', Math.round(progress.percent));
  });

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    log.info('[Updater] Update downloaded, will install on quit:', info.version);
    wm.broadcastToAll('update:ready', info.version);
  });

  autoUpdater.on('error', (err: Error) => {
    log.error('[Updater] Error:', err);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err: Error) => log.warn('[Updater]', err));
  }, 5000);

  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err: Error) => log.warn('[Updater]', err));
  }, 4 * 60 * 60 * 1000);
}
