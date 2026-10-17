// Cat Jam — Electron ana süreci
// Üretimde dist/ klasörünü kendi loopback HTTP sunucusuyla servis eder:
// localhost = güvenli bağlam → File System Access, IndexedDB, service worker,
// WASM streaming (whisper) hepsi sorunsuz çalışır.
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.ELECTRON_START_URL || '';
const BASE_PORT = 41737;

let win = null;

// Notu PDF'e yaz: renderer tam HTML dokümanını gönderir; gizli pencerede
// açıp printToPDF ile A4 PDF üretir, kaydetme diyaloğunu gösterir.
ipcMain.handle('catjam:print-to-pdf', async (_evt, html, fileName) => {
  const parent = BrowserWindow.getAllWindows().find((w) => w.isVisible());
  const tmp = path.join(app.getPath('temp'), `catjam-print-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await w.loadURL('file:///' + tmp.replace(/\\/g, '/'));
    await new Promise((r) => setTimeout(r, 350)); // görseller/layout otursun
    const data = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    const { canceled, filePath } = await dialog.showSaveDialog(parent || w, {
      title: 'Cat Jam — PDF',
      defaultPath: (fileName || 'CatJam-not') + '.pdf',
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, data);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    try { w.destroy(); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
});

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

function startStaticServer() {
  // sırayla boş port dene
  let attempts = 0;
  const tryListen = () => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname.includes('..')) { res.writeHead(403); return res.end('forbidden'); }
        let file = path.join(DIST, pathname);
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          // uzantı yoksa SPA fallback → index.html
          if (!path.extname(pathname)) file = path.join(DIST, 'index.html');
        }
        if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
        fs.createReadStream(file).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end('server error');
      }
    });
    server.on('error', () => {
      if (attempts++ < 20) { server.close(); server.listen(++BASE_PORT, '127.0.0.1', tryListen); }
      else { console.error('catjam: boş port bulunamadı'); app.quit(); }
    });
    server.listen(BASE_PORT ? BASE_PORT : 0, '127.0.0.1');
    server.on('listening', () => {
      const port = server.address().port;
      console.log('catjam static server → http://127.0.0.1:%d', port);
      createWindow(`http://127.0.0.1:${port}`);
    });
    return server;
  };
  return tryListen();
}

function createWindow(loadUrl) {
  win = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 700,
    minHeight: 480,
    title: 'Cat Jam Notes',
    autoHideMenuBar: true,
    backgroundColor: '#111214',
    icon: path.join(__dirname, '..', 'public', 'icons', 'cat-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.loadURL(loadUrl);
  // dış bağlantıları sistem tarayıcısında aç
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  if (DEV_URL) win.webContents.openDevTools({ mode: 'detach' });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    if (!DEV_URL) Menu.setApplicationMenu(null); // obsidian gibi sade pencere
    if (DEV_URL) createWindow(DEV_URL);
    else startStaticServer();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && DEV_URL) createWindow(DEV_URL); });
  });
  app.on('window-all-closed', () => app.quit());
}
