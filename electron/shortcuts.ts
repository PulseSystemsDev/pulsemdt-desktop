import { globalShortcut } from 'electron';
import log from 'electron-log';
import type { WindowManager } from './windowManager';

const SHORTCUTS: Array<{ accelerator: string; action: (wm: WindowManager) => void }> = [
  { accelerator: 'CmdOrCtrl+Shift+D', action: wm => wm.openPanel('dispatch') },
  { accelerator: 'CmdOrCtrl+Shift+M', action: wm => wm.openPanel('map')      },
  { accelerator: 'CmdOrCtrl+Shift+T', action: wm => wm.openPanel('mdt')      },
  { accelerator: 'CmdOrCtrl+Shift+E', action: wm => wm.openPanel('ems')      },
  { accelerator: 'CmdOrCtrl+Shift+Q', action: wm => wm.dispatchToMain('duty:toggle') },
];

export function registerShortcuts(wm: WindowManager) {
  for (const { accelerator, action } of SHORTCUTS) {
    const ok = globalShortcut.register(accelerator, () => action(wm));
    if (!ok) log.warn(`[Shortcuts] Failed to register: ${accelerator}`);
    else     log.debug(`[Shortcuts] Registered: ${accelerator}`);
  }
}

export function unregisterShortcuts() {
  globalShortcut.unregisterAll();
  log.debug('[Shortcuts] All shortcuts unregistered');
}
