const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { startServer, stopServer, isRunning, getLanIp, getConfig, saveConfig, setDataDir } = require('./server-module');
const { createLogger } = require('./lib/logger');
let log = createLogger({ pretty: true, level: 'info', name: 'electron' });

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
    // The CSS -webkit-app-region:drag approach doesn't work reliably on
    // every Windows + Electron combination. As a belt-and-suspenders fix,
    // we also enable the Electron-native titleBarOverlay which handles
    // window movement at the compositor level. The overlay height is set
    // to 0 so it's invisible (we render our own header with our own
    // minimize/maximize/close buttons) but the DRAG from the header still
    // works because frame:false + titleBarStyle:'hidden' enables native
    // move on any area marked drag.
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
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

// JS-driven window move — renderer sends (dx, dy) deltas on each mousemove.
// Detect which window sent the event so both main and mini can be dragged.
ipcMain.handle('window:move', (event, dx, dy) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
});

// Show + focus the main window (called from mini-player close/show button).
ipcMain.handle('window:show-main', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// Window controls (frameless)
ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
// Close button: send an event to the renderer which shows an in-app
// confirmation modal. The renderer calls back with the user's choice.
ipcMain.handle('window:close', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:close-requested');
});
ipcMain.handle('window:close-confirm', (event, action) => {
  if (action === 'quit') { app.isQuitting = true; app.quit(); }
  else if (action === 'tray') { if (mainWindow) mainWindow.hide(); }
});

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

// Renderer logging: append console.log/warn/error calls to userData/logs/renderer.log
// with automatic rotation when file reaches ~1MB.
ipcMain.handle('log:write', (event, level, message) => {
  try {
    const dataDir = app.getPath('userData');
    const logsDir = path.join(dataDir, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const logFile = path.join(logsDir, 'renderer.log');
    const maxSize = 1024 * 1024; // 1 MB
    const rotatedFile = path.join(logsDir, 'renderer.log.1');

    // Check if we need to rotate
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size >= maxSize) {
        // Rotate: move current log to .1, start fresh
        if (fs.existsSync(rotatedFile)) fs.unlinkSync(rotatedFile);
        fs.renameSync(logFile, rotatedFile);
      }
    }

    // Append with timestamp and level
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (e) {
    // Silent fail — don't crash the app if logging fails
    console.error('[log:write] error:', e.message);
  }
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
  // Dedicated mini.html with its own layout + WS sync. Pass the auth
  // token so the mini-player can call /api/* and connect to the WS.
  const cfg = getConfig() || {};
  const token = cfg.authToken || '';
  const theme = cfg.theme || 'auto';
  miniWindow.loadURL(`http://localhost:${serverPort}/mini.html?t=${encodeURIComponent(token)}&theme=${theme}`);
  miniWindow.on('closed', () => {
    miniWindow = null;
    // Notify the main renderer so the '...' menu's Mini-player toggle
    // reflects the actual state (otherwise it stays 'Enabled' after a
    // close-via-× from the mini window).
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('miniplayer:closed');
    }
  });
}

ipcMain.handle('miniplayer:toggle', () => { toggleMiniPlayer(); });

// ─── Auto Updater ───────────────────────────────────────────────────────────
// We mirror every updater event into `updateState` so that a renderer that
// loads AFTER the first checkForUpdates() (which fires 5s into the app boot
// and can outpace the script bundle on cold install) can still read the
// current status via the `app:get-update-state` IPC handler below. Without
// this mirror the renderer's update badge stayed invisible because the
// 'app:update-available' webContents.send had already been emitted before
// the listener was wired.
let updateState = { status: 'idle', version: null, percent: null };

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    updateState = { status: 'available', version: info.version, percent: null };
    notifyRenderer('app:update-available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    updateState = { status: 'uptodate', version: null, percent: null };
    notifyRenderer('app:update-uptodate', {});
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    updateState = Object.assign({}, updateState, { status: 'downloading', percent });
    notifyRenderer('app:update-progress', { percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateState = { status: 'ready', version: info.version, percent: 100 };
    log.info('update downloaded', { version: info && info.version });
    notifyRenderer('app:update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    updateState = Object.assign({}, updateState, { status: 'error', error: err.message });
    log.error('autoUpdater error', { error: err.message });
    notifyRenderer('app:update-error', { message: err.message });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('update available', { version: info && info.version });
  });

  // Delay update check to ensure renderer is ready to receive events
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.info('update check skipped', { error: err.message });
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
  // Reset state so the UI shows "Checking…" while the request is in flight
  // (the autoUpdater events overwrite it when they fire).
  updateState = { status: 'checking', version: null, percent: null };
  autoUpdater.checkForUpdates().catch((err) => {
    updateState = { status: 'error', error: err.message };
    log.info('manual update check failed', { error: err.message });
    notifyRenderer('app:update-error', { message: err.message });
  });
});

// IPC: renderer pulls the current state on boot (avoids the race where the
// main process emitted 'update-available' before the renderer's listener
// was registered).
ipcMain.handle('app:get-update-state', () => updateState);

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
  // Wire the Electron main process logger to userData/logs/electron.log,
  // separate file from the server's so they can be tailed independently.
  // We use createLogger (not setLogConfig) so we don't stomp the server's
  // global logger.
  log = createLogger({
    dir: path.join(app.getPath('userData'), 'logs'),
    level: isDev ? 'debug' : 'info',
    pretty: isDev,
    name: 'electron',
  });
  log.info('app starting', { version: app.getVersion(), platform: process.platform, dev: isDev });

  // Resolve port from config (fallback 3000)
  const cfg = getConfig() || {};
  const desiredPort = Number.isInteger(cfg.port) && cfg.port > 0 && cfg.port < 65536
    ? cfg.port
    : 3000;

  // Always start server locally (UI needs it for fetch/WS)
  try {
    const result = await startServer(desiredPort);
    serverPort = (result && result.port) || desiredPort;
    log.info('server started from main', { port: serverPort });
  } catch (err) {
    log.error('server failed to start', { error: err.message });
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
