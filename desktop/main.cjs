/** Electron window shell around the gateway's web UI. It starts or reuses the gateway through the installed CLI, shows
 * one sandboxed window confined to that origin and hands every other link to the system browser. Closing or quitting
 * the window never stops the gateway or its runs. */
const { app, BrowserWindow, dialog, Menu, nativeTheme, shell } = require('electron');
const { execFile } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { isInternal, isExternal, gatewayUrl, themeSource } = require('./policy.cjs');

app.setName('HUI');
// CLI and installed bundle use the same lock, cookies and IndexedDB location.
app.setPath('userData', path.join(app.getPath('appData'), 'HUI'));
let window;
let url;

// Electron's default viewMenu binds Zoom In to CommandOrControl+Plus only, which
// needs Shift on US layouts, so the browser-standard Cmd/Ctrl+= does nothing.
// The hidden item keeps that shortcut without a duplicate visible entry.
const viewMenu = {
  label: 'View',
  submenu: [
    { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' },
    { role: 'resetZoom' }, { role: 'zoomIn' },
    { role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false, acceleratorWorksWhenHidden: true },
    { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
  ],
};
// Electron disables pinch-to-zoom by default and resets the limits on every
// load, so re-enable it for each document the window shows.
const PINCH_ZOOM_LIMITS = [1, 3];

// HUI's themeMode values are exactly Electron's themeSource values. Following
// the saved preference keeps prefers-color-scheme and the native title bar in
// step with the page; 'system' (the default) tracks the OS live.
async function syncThemeSource() {
  let mode = 'system';
  try {
    const response = await fetch(new URL('/__hui/settings', url), { headers: { 'x-hui': '1' } });
    if (response.ok) mode = themeSource((await response.json()).themeMode);
  } catch {}
  nativeTheme.themeSource = mode;
}

function showWindow() {
  if (!url) return;
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    title: 'HUI', width: 1280, height: 850, minWidth: 360, minHeight: 480,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#fafaf9', show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const origin = new URL(url).origin;
  const openExternal = (target) => {
    if (isExternal(target)) void shell.openExternal(target).catch(() => {});
  };
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: 'deny' };
  });
  for (const event of ['will-navigate', 'will-redirect']) {
    window.webContents.on(event, (e, target) => {
      if (!isInternal(target, origin)) { e.preventDefault(); openExternal(target); }
    });
  }
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('did-finish-load', () => {
    void window?.webContents.setVisualZoomLevelLimits(...PINCH_ZOOM_LIMITS).catch(() => {});
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(['clipboard-sanitized-write', 'fullscreen'].includes(permission) && isInternal(contents.getURL(), origin));
  });
  // Re-read after an in-app Appearance change, or one made from another client.
  window.webContents.session.webRequest.onCompleted({ urls: [`${origin}/__hui/settings`] }, (details) => {
    if (details.method === 'PUT') void syncThemeSource();
  });
  window.on('focus', () => { void syncThemeSource(); });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = undefined; });
  void window.loadURL(url).catch((error) => {
    dialog.showErrorBox('HUI could not open', error.message);
    app.quit();
  });
}

async function start() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  // Closing a window must not interrupt agent runs. Quit is explicit.
  app.on('window-all-closed', () => {});
  await app.whenReady();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'HUI', submenu: [{ label: 'Show HUI', click: showWindow }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, viewMenu, { role: 'windowMenu' },
  ]));
  try {
    const config = JSON.parse(process.env.HUI_DESKTOP_LAUNCH || readFileSync(path.join(app.getAppPath(), 'launch.json'), 'utf8'));
    nativeTheme.themeSource = 'system';
    const output = await new Promise((resolve, reject) => {
      execFile(config.node, [path.join(config.root, 'bin/hui.mjs'), 'gateway', 'start', '--json'], {
        cwd: app.getPath('home'), env: { ...process.env, PATH: config.searchPath || process.env.PATH },
        timeout: 30000, maxBuffer: 1024 * 1024,
      }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    // The existing CLI authenticates gateway identity and prevents duplicates.
    // Closing or quitting the UI must never stop a shared gateway or its jobs.
    url = gatewayUrl(output);
    await syncThemeSource();
    showWindow();
  } catch (error) {
    dialog.showErrorBox('HUI could not start', `${error.message}\nReinstall the npm package or run hui install-app to repair the launcher.`);
    app.quit();
  }
}

void start();
