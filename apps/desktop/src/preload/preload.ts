import { contextBridge, ipcRenderer } from 'electron';
import { type DesktopBridge, IPC, type UpdateState } from '../shared/bridge';

// Sandboxed preload (contextIsolation + sandbox): only `contextBridge` and `ipcRenderer` are used,
// and the page gets plain functions - never ipcRenderer itself.
const bridge: DesktopBridge = {
  platform: process.platform,
  storage: {
    info: () => ipcRenderer.invoke(IPC.storageInfo),
    reveal: () => ipcRenderer.invoke(IPC.storageReveal),
  },
  lock: {
    onLocked: (listener) => {
      // Only the reason string reaches the page, never the IPC event.
      const handler = (_event: unknown, reason: unknown) =>
        listener(typeof reason === 'string' ? reason : 'unknown');
      ipcRenderer.on(IPC.locked, handler);
      return () => {
        ipcRenderer.removeListener(IPC.locked, handler);
      };
    },
    setIdleMinutes: (minutes) =>
      ipcRenderer.invoke(IPC.lockIdleMinutes, minutes),
  },
  updates: {
    state: () => ipcRenderer.invoke(IPC.updateState),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    onState: (listener) => {
      const handler = (_event: unknown, state: unknown) =>
        listener(state as UpdateState);
      ipcRenderer.on(IPC.updateChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.updateChanged, handler);
      };
    },
  },
  locale: {
    set: (locale) => ipcRenderer.invoke(IPC.localeSet, locale),
  },
};

contextBridge.exposeInMainWorld('mirrorbaseDesktop', bridge);
