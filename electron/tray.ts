import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';
import log from 'electron-log';
import type { WindowManager } from './windowManager';

let tray: Tray | null = null;
let changeServerHandler: (() => void) | null = null;

function buildTrayIcon(): Electron.NativeImage {
  try {
    return nativeImage.createFromPath(path.join(__dirname, '../resources/tray-icon.png'));
  } catch {
    const { PNG_16 } = require('./trayIconFallback');
    return nativeImage.createFromBuffer(Buffer.from(PNG_16, 'base64'));
  }
}

export function setupTray(wm: WindowManager, onChangeServer?: () => void) {
  changeServerHandler = onChangeServer ?? null;
  const icon = buildTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('PulseMDT');
  rebuildMenu(wm);

  tray.on('double-click', () => wm.focusMain());
}

export function rebuildMenu(wm: WindowManager) {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    {
      label: 'PulseMDT',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Dispatch',
      accelerator: 'CmdOrCtrl+Shift+D',
      click: () => { wm.openPanel('dispatch'); },
    },
    {
      label: 'Open Live Map',
      accelerator: 'CmdOrCtrl+Shift+M',
      click: () => { wm.openPanel('map'); },
    },
    {
      label: 'Open MDT',
      accelerator: 'CmdOrCtrl+Shift+T',
      click: () => { wm.openPanel('mdt'); },
    },
    {
      label: 'Open EMS Board',
      click: () => { wm.openPanel('ems'); },
    },
    { type: 'separator' },
    {
      label: 'Toggle On Duty',
      accelerator: 'CmdOrCtrl+Shift+Q',
      click: () => { wm.dispatchToMain('duty:toggle'); },
    },
    { type: 'separator' },
    {
      label: 'Change Server…',
      click: () => { changeServerHandler?.(); },
    },
    {
      label: 'Quit PulseMDT',
      role: 'quit',
    },
  ]);

  tray.setContextMenu(menu);
  log.debug('[Tray] Menu rebuilt');
}

export function destroyTray() {
  tray?.destroy();
  tray = null;
}
