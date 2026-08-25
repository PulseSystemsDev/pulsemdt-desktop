import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('signinAPI', {
  onCode: (cb: (data: { userCode: string; verificationUri: string; verificationUriComplete: string }) => void) => {
    const listener = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on('signin:code', listener);
    return () => ipcRenderer.removeListener('signin:code', listener);
  },

  onStatus: (cb: (data: { state: string; message?: string }) => void) => {
    const listener = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on('signin:status', listener);
    return () => ipcRenderer.removeListener('signin:status', listener);
  },

  cancel: (): Promise<void> => ipcRenderer.invoke('signin:cancel'),

  openLink: (url: string): Promise<void> => ipcRenderer.invoke('signin:open-link', url),

  retry: (): Promise<void> => ipcRenderer.invoke('signin:retry'),
});
