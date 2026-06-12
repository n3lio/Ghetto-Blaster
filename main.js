const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { startServer, stopServer, isRunning, getLanIp, getConfig, saveConfig, setDataDir } = require('./server-module');

let mainWindow = null;
let tray = null;
let serverPort = 3000;
const isDev = process.argv.includes('--dev');

// ─── Single Instance Lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── Create Window ──────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Ghetto Blaster',
    icon: getIconPath(),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: '#0a0a0b',
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  if (isDev) {
    // Renderer hot reload: watch public/ and tell the window to reload when
    // anything in it changes. Cheap fs.watch is fine — we don't need the
    // full chokidar machinery for a dev-only loop.
    try {
      const watchDir = path.join(__dirname, 'public');
      let reloadTimer = null;
      fs.watch(watchDir, { recursive: true }, (event, filename) => {
        if (!filename) return;
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            console.log(`[dev] reload (${filename})`);
            mainWindow.webContents.reloadIgnoringCache();
          }
        }, 200);
      });
    } catch (e) {
      console.warn('[dev] hot reload watcher failed:', e.message);
    }
  }

  mainWindow.on('close', () => {
    app.isQuitting = true;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Tray ───────────────────────────────────────────────────────────────────
function createTray() {
  const icon = getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Ghetto Blaster');
  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu() {
  const port = (getConfig() && getConfig().port) || 3000;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Ghetto Blaster',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
      },
    },
    {
      label: 'Mini Player',
      click: () => toggleMiniPlayer(),
    },
    { type: 'separator' },
    { label: `Server: ${getLanIp()}:${port}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

// ─── Icon Helpers ───────────────────────────────────────────────────────────
function getIconPath() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = path.join(__dirname, 'assets', iconName);
  try {
    if (fs.existsSync(iconPath)) return iconPath;
  } catch (e) { /* ignore */ }
  return undefined;
}

function getTrayIcon() {
  const iconPath = getIconPath();
  if (iconPath) {
    // Resize to 16x16 for tray (removes excess padding)
    const img = nativeImage.createFromPath(iconPath);
    return img.resize({ width: 16, height: 16 });
  }
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = 232; canvas[i * 4 + 1] = 164;
    canvas[i * 4 + 2] = 53; canvas[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function notifyRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────
ipcMain.handle('server:status', () => {
  return { running: true, ip: getLanIp(), port: serverPort };
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('app:restart-update', () => {
  autoUpdater.quitAndInstall();
});

// Window controls (frameless)
ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.handle('window:close', () => { if (mainWindow) mainWindow.close(); });

// Open Bluetooth settings (Windows)
ipcMain.handle('app:open-bt-settings', () => {
  const { exec } = require('child_process');
  exec('start ms-settings:bluetooth');
});

// Config / Settings
ipcMain.handle('config:get', () => getConfig());

ipcMain.handle('config:set', (event, newConfig) => {
  saveConfig(newConfig);
  return { ok: true };
});

ipcMain.handle('config:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Music Folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ─── Mini-player (compact, always-on-top) ──────────────────────────────────
let miniWindow = null;

function toggleMiniPlayer() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.close();
    return;
  }
  miniWindow = new BrowserWindow({
    width: 360,
    height: 120,
    minWidth: 280,
    minHeight: 90,
    resizable: true,
    alwaysOnTop: true,
    frame: false,
    skipTaskbar: false,
    title: 'Ghetto Blaster — Mini',
    icon: getIconPath(),
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  miniWindow.setMenu(null);
  // Reuse the same SPA — `?mini=1` lets the renderer switch to a compact
  // layout. If it isn't wired yet (Phase 6 frontend work), the page just
  // renders normally inside a small window — usable but not pretty.
  miniWindow.loadURL(`http://localhost:${serverPort}/?mini=1`);
  miniWindow.on('closed', () => { miniWindow = null; });
}

ipcMain.handle('miniplayer:toggle', () => { toggleMiniPlayer(); });

// ─── Auto Updater ───────────────────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    notifyRenderer('app:update-available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    notifyRenderer('app:update-uptodate', {});
  });

  autoUpdater.on('download-progress', (progress) => {
    notifyRenderer('app:update-progress', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    notifyRenderer('app:update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message);
    notifyRenderer('app:update-error', { message: err.message });
  });

  // Delay update check to ensure renderer is ready to receive events
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('Update check skipped:', err.message);
    });
  }, 5000);
}

// IPC: user confirms they want to download the update
ipcMain.handle('app:download-update', () => {
  autoUpdater.downloadUpdate().catch((err) => {
    console.error('Download update failed:', err.message);
    notifyRenderer('app:update-error', { message: err.message });
  });
});

// IPC: user wants to re-check for updates (from Settings)
ipcMain.handle('app:check-update', () => {
  autoUpdater.checkForUpdates().catch((err) => {
    console.log('Manual update check failed:', err.message);
    notifyRenderer('app:update-error', { message: err.message });
  });
});

// ─── Splash Screen ──────────────────────────────────────────────────────────
let splashWindow = null;

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 340,
    height: 220,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false },
  });

  const splashHtml = `data:text/html,
    <style>
      body { margin:0; display:flex; align-items:center; justify-content:center; height:100vh; background:transparent; font-family:'Segoe UI',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
      .splash { background:%230f0e0d; border-radius:20px; padding:44px 54px; text-align:center; position:relative; overflow:hidden; }
      .splash::before { content:''; position:absolute; inset:-2px; border-radius:22px; padding:2px; background:conic-gradient(from 0deg, %23c47a7a, %23e8943a, %23e8d44a, %23f0ebe4, %23b68adf, %23c47a7a); -webkit-mask:linear-gradient(%23fff 0 0) content-box, linear-gradient(%23fff 0 0); -webkit-mask-composite:xor; mask-composite:exclude; animation:spin 4s linear infinite; opacity:0.5; }
      @keyframes spin { to { rotate:360deg; } }
      h1 { font-size:1.3rem; font-weight:400; color:%23f0ebe4; margin:0 0 14px; letter-spacing:-0.02em; position:relative; }
      h1 b { font-weight:800; }
      p { position:relative; margin:0; }
      .dot { display:inline-block; width:4px; height:4px; border-radius:50%25; background:%23f0ebe4; margin:0 3px; animation:pulse 1.4s ease-in-out infinite; opacity:0.25; }
      .dot:nth-child(2){animation-delay:0.2s} .dot:nth-child(3){animation-delay:0.4s}
      @keyframes pulse{0%25,100%25{opacity:0.2}50%25{opacity:0.7}}
    </style>
    <div class="splash">
      <h1>Ghetto <b>Blaster</b></h1>
      <p><span class="dot"></span><span class="dot"></span><span class="dot"></span></p>
    </div>`;

  splashWindow.loadURL(splashHtml);
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplash();

  // Set data dir to userData (persists across updates)
  setDataDir(app.getPath('userData'));

  // Resolve port from config (fallback 3000)
  const cfg = getConfig() || {};
  const desiredPort = Number.isInteger(cfg.port) && cfg.port > 0 && cfg.port < 65536
    ? cfg.port
    : 3000;

  // Always start server locally (UI needs it for fetch/WS)
  try {
    const result = await startServer(desiredPort);
    serverPort = (result && result.port) || desiredPort;
    console.log(`Server started on port ${serverPort}`);
  } catch (err) {
    console.error('Failed to start server:', err.message);
    serverPort = desiredPort;
  }

  createWindow();
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Close splash when main window is ready (min 1.5s display)
  const splashStart = Date.now();
  mainWindow.once('ready-to-show', () => {
    const elapsed = Date.now() - splashStart;
    const delay = Math.max(0, 1500 - elapsed);
    setTimeout(() => {
      if (splashWindow) { splashWindow.close(); splashWindow = null; }
    }, delay);
  });

  createTray();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  await stopServer();
});
