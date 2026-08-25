import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('setupAPI', {
  testConnection: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('setup:test', url),

  save: (url: string): Promise<void> =>
    ipcRenderer.invoke('setup:save', url),
});
