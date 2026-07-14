const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatdeck', {
  getBootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  refreshCodex: () => ipcRenderer.invoke('codex:usage'),
  refreshMarket: (secids) => ipcRenderer.invoke('market:snapshot', secids),
  refreshKline: (secid, period) => ipcRenderer.invoke('market:kline', secid, period),
  refreshFundFlow: (secid) => ipcRenderer.invoke('market:fund-flow', secid),
  refreshWeather: (query) => ipcRenderer.invoke('weather:forecast', query),
  saveSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  saveAiConfig: (config) => ipcRenderer.invoke('ai:config', config),
  testAiConnection: (config) => ipcRenderer.invoke('ai:test-connection', config),
  analyzeStock: (request) => ipcRenderer.invoke('ai:analyze', request),
  getAiHistory: () => ipcRenderer.invoke('ai:history'),
  removeAiHistory: (id) => ipcRenderer.invoke('ai:history:remove', id),
  clearAiHistory: () => ipcRenderer.invoke('ai:history:clear'),
  getAlertStatus: () => ipcRenderer.invoke('holding:alert-status'),
  copyText: (value) => ipcRenderer.invoke('clipboard:write', value),
  resizePanel: (panel) => ipcRenderer.invoke('window:panel', panel),
  minimize: () => ipcRenderer.send('window:minimize'),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  onRefreshRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:refresh', listener);
    return () => ipcRenderer.removeListener('app:refresh', listener);
  },
  onHoldingAlert: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('holding:alert', listener);
    return () => ipcRenderer.removeListener('holding:alert', listener);
  },
  onAlertStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('holding:alert-status', listener);
    return () => ipcRenderer.removeListener('holding:alert-status', listener);
  },
});
