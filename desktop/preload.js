const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usageApi', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  refresh: () => ipcRenderer.send('refresh'),
  login: () => ipcRenderer.send('login'),
  hide: () => ipcRenderer.send('hide'),
  setCollapsed: (c) => ipcRenderer.send('collapse', c),
  resize: (width, height) => ipcRenderer.send('resize', { width, height }),
  setTrayIcon: (dataUrl) => ipcRenderer.send('tray-icon', dataUrl),
});
