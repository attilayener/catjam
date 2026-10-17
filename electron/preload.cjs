// Cat Jam — Electron preload (contextBridge)
// Renderer'a güvenli, dar bir masaüstü API yüzeyi açar; nodeIntegration kapalı kalır.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('catjamDesktop', {
  // html: tam bağımsız <html> dokümanı; fileName: önerilen dosya adı (uzantısız)
  printToPDF: (html, fileName) =>
    ipcRenderer.invoke('catjam:print-to-pdf', html, fileName),
});
