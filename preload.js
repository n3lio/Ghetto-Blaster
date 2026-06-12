const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('resonance', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // Server info
  getServerStatus: () => ipcRenderer.invoke('server:status'),

  // Mini-player toggle
  toggleMiniPlayer: () => ipcRenderer.invoke('miniplayer:toggle'),

  // Config / Settings
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  pickFolder: () => ipcRenderer.invoke('config:pick-folder'),

  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  restartToUpdate: () => ipcRenderer.invoke('app:restart-update'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-update'),
  openBluetoothSettings: () => ipcRenderer.invoke('app:open-bt-settings'),

  // Events
  onUpdateAvailable: (cb) => ipcRenderer.on('app:update-available', (_, d) => cb(d)),
  onUpdateProgress: (cb) => ipcRenderer.on('app:update-progress', (_, d) => cb(d)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('app:update-downloaded', (_, d) => cb(d)),
  onUpdateError: (cb) => ipcRenderer.on('app:update-error', (_, d) => cb(d)),
  onUpdateUpToDate: (cb) => ipcRenderer.on('app:update-uptodate', (_, d) => cb(d)),

  isElectron: true,
});
