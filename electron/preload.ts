import { contextBridge, ipcRenderer } from 'electron';
import type { PanelId } from './types';

contextBridge.exposeInMainWorld('pulseDesktop', {
  platform:  process.platform,
  version:   process.env.npm_package_version ?? '1.0.0',
  isDesktop: true,

  openPanel: (panelId: PanelId) => {
    ipcRenderer.send('panel:open', panelId);
  },

  closePanel: (panelId: PanelId) => {
    ipcRenderer.send('panel:close', panelId);
  },

  openMulti: (panelIds: PanelId[]) => {
    ipcRenderer.send('panel:openMulti', panelIds);
  },

  getPanelStatus: (): Promise<Record<PanelId, boolean>> => {
    return ipcRenderer.invoke('panel:getStatus');
  },

  onPanelStatusChange: (cb: (status: Record<PanelId, boolean>) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: Record<PanelId, boolean>) => cb(status);
    ipcRenderer.on('panel:status-changed', handler);
    return () => ipcRenderer.removeListener('panel:status-changed', handler);
  },

  onUpdateAvailable: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },

  onDutyAction: () => {
    ipcRenderer.send('duty:toggle');
  },
});
