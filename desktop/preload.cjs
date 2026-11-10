// Exposes a small, fixed set of operations to the Wander window. The renderer never sees the
// desktop token, the helper process, or Node APIs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wander', {
  status: () => ipcRenderer.invoke('wander:status'),
  listApps: () => ipcRenderer.invoke('wander:listApps'),
  requestPermission: () => ipcRenderer.invoke('wander:requestPermission'),
  recheckPermission: () => ipcRenderer.invoke('wander:recheckPermission'),
  ask: (task, pid, appName) => ipcRenderer.invoke('wander:ask', { task, pid, appName }),
  check: () => ipcRenderer.invoke('wander:check'),
  stop: () => ipcRenderer.invoke('wander:stop'),
  finderDemo: () => ipcRenderer.invoke('wander:finderDemo'),
  openSettings: () => ipcRenderer.invoke('wander:openSettings'),
  getExtension: () => ipcRenderer.invoke('wander:getExtension'),
  onUpdate: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('wander:update', listener);
    return () => ipcRenderer.removeListener('wander:update', listener);
  }
});
