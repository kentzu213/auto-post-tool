const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ============================================================================
// Izzi Auto Post — Thin hosted-URL shell (Req 14.3, 14.4)
// ----------------------------------------------------------------------------
// The backend (API / Web / Worker / Postgres / Redis / MinIO) is HOSTED.
// This desktop app no longer spawns or port-probes any local service. It is a
// thin shell that resolves a configurable hosted URL and loads it.
// ============================================================================

// TODO: REPLACE this placeholder with the real production web app URL before
// shipping. It is only used as the last-resort fallback when no URL is provided
// via the IZZI_SERVER_URL env var, the persisted config file, or the first-run
// prompt.
const DEFAULT_HOSTED_URL = 'https://app.example.com';

let mainWindow = null;
let promptWindow = null;

// Persisted config lives in the per-user app data dir so it survives restarts
// and is independent of the install location. Shape: { "serverUrl": "https://..." }
function getConfigFile() {
  return path.join(app.getPath('userData'), 'izzi-config.json');
}

function readPersistedUrl() {
  try {
    const file = getConfigFile();
    if (fs.existsSync(file)) {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cfg && typeof cfg.serverUrl === 'string' && cfg.serverUrl.trim()) {
        return cfg.serverUrl.trim();
      }
    }
  } catch (e) {
    console.error('[izzi-config] Không đọc được izzi-config.json:', e.message);
  }
  return null;
}

function persistUrl(url) {
  try {
    fs.writeFileSync(getConfigFile(), JSON.stringify({ serverUrl: url }, null, 2), 'utf8');
  } catch (e) {
    console.error('[izzi-config] Không ghi được izzi-config.json:', e.message);
  }
}

// Accepts bare hosts ("app.example.com") and normalizes to a valid absolute URL.
// Returns null for empty/invalid input.
function normalizeUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    value = 'https://' + value;
  }
  try {
    return new URL(value).toString();
  } catch (e) {
    return null;
  }
}

// Resolve the base URL to load, in precedence order (Req 14.4):
//   1) IZZI_SERVER_URL environment variable
//   2) persisted config file (userData/izzi-config.json)
//   3) first-run prompt (the entered URL is persisted for next launch)
//   4) DEFAULT_HOSTED_URL placeholder constant
async function resolveBaseUrl() {
  const fromEnv = normalizeUrl(process.env.IZZI_SERVER_URL);
  if (fromEnv) return fromEnv;

  const fromFile = normalizeUrl(readPersistedUrl());
  if (fromFile) return fromFile;

  const fromPrompt = await promptForUrl();
  if (fromPrompt) {
    persistUrl(fromPrompt); // skip the prompt on subsequent launches
    return fromPrompt;
  }

  return DEFAULT_HOSTED_URL;
}

// Show a simple input window asking for the hosted server URL.
// Resolves with a normalized URL string, or null if cancelled/closed.
function promptForUrl() {
  return new Promise((resolve) => {
    promptWindow = new BrowserWindow({
      width: 560,
      height: 380,
      frame: false,
      resizable: false,
      backgroundColor: '#05070f',
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler('izzi-prompt-default');
      ipcMain.removeListener('izzi-prompt-submit', onSubmit);
      ipcMain.removeListener('izzi-prompt-cancel', onCancel);
      const win = promptWindow;
      promptWindow = null;
      if (win && !win.isDestroyed()) win.close();
      resolve(value);
    };

    const onSubmit = (_event, raw) => finish(normalizeUrl(raw));
    const onCancel = () => finish(null);

    // Let the renderer prefill the input with the documented default.
    ipcMain.handle('izzi-prompt-default', () => DEFAULT_HOSTED_URL);
    ipcMain.on('izzi-prompt-submit', onSubmit);
    ipcMain.on('izzi-prompt-cancel', onCancel);

    promptWindow.loadFile(path.join(__dirname, 'launcher.html'));
    promptWindow.once('ready-to-show', () => promptWindow.show());
    // If the user closes the window without submitting, treat as cancel.
    promptWindow.on('closed', () => finish(null));
  });
}

// Re-prompt for a new URL, persist it, and reload the main window.
// Wired to a menu item and to load-failure recovery.
async function changeServerUrl() {
  const url = await promptForUrl();
  if (!url) return;
  persistUrl(url);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(url);
  }
}

function createMainWindow(base) {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 768,
    title: 'Izzi Auto Post',
    backgroundColor: '#05070f',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(base);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // If the hosted URL fails to load, offer to change it or retry.
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return; // ignore sub-resource failures
      if (errorCode === -3) return; // ERR_ABORTED (e.g. redirect) — not a real failure
      dialog
        .showMessageBox(mainWindow, {
          type: 'error',
          title: 'Không tải được máy chủ',
          message: `Không thể kết nối tới: ${validatedURL || base}`,
          detail: `${errorDescription} (mã ${errorCode}). Bạn có thể đổi URL máy chủ hoặc thử lại.`,
          buttons: ['Đổi URL máy chủ', 'Thử lại', 'Đóng'],
          defaultId: 0,
          cancelId: 2
        })
        .then((result) => {
          if (result.response === 0) {
            changeServerUrl();
          } else if (result.response === 1 && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.reload();
          }
        });
    }
  );

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildAppMenu() {
  const template = [
    {
      label: 'Tệp',
      submenu: [
        { label: 'Đổi URL máy chủ…', click: () => changeServerUrl() },
        { type: 'separator' },
        { role: 'quit', label: 'Thoát' }
      ]
    },
    {
      label: 'Xem',
      submenu: [
        { role: 'reload', label: 'Tải lại' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Electron lifecycle
app.whenReady().then(async () => {
  buildAppMenu();
  const base = await resolveBaseUrl();
  createMainWindow(base);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (mainWindow === null && promptWindow === null) {
    const base = await resolveBaseUrl();
    createMainWindow(base);
  }
});
