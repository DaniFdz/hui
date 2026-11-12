/** Electron window shell around the gateway's web UI. It starts or reuses the gateway through the installed CLI, shows
 * one sandboxed window confined to that origin and hands every other link to the system browser. Closing or quitting
 * the window never stops the gateway or its runs. Native notification clicks open their originating chat, and so does
 * a `hui://sessions/<id>` link, which is what the web app's `?open=app` hand-off and any launcher send. Every download
 * asks where to save it, because Electron would otherwise save it straight into Downloads.
 *
 * The window's chrome follows the colour mode this device chose in the page, which `preload.cjs` reports over IPC.
 * The shell keeps the last mode it heard in its own `userData`, and the gateway is never asked: appearance belongs to
 * the screen, and one gateway serves many.
 *
 * An older HUI kept appearance in the gateway's settings.json. `hui doctor --fix` exports the look that file held to
 * `desktop-appearance.json` in the gateway's config directory, and this shell hands it to the page once: the page
 * applies it only to a device that stored no appearance of its own, then has the seed marked consumed. */
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, Notification } = require('electron');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { isInternal, isExternal, gatewayUrl, themeSource, chatUrl, appChatPath, notificationFromUrl } = require('./policy.cjs');

app.setName('HUI');
// CLI and installed bundle use the same lock, cookies and IndexedDB location.
app.setPath('userData', path.join(app.getPath('appData'), 'HUI'));
let window;
let url;
const pendingNotifications = [];
const notifications = new Set();
let launchedForNotification = false;
let launchedFromBanner;
/** A `hui://` chat link that arrived before the gateway address was known. */
let launchedFromChatLink;

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

// HUI's themeMode values are exactly Electron's themeSource values. The page
// reports the one it stored on this device, which keeps prefers-color-scheme and
// the native title bar in step with it; 'system' (the default) tracks the OS.
const THEME_CHANNEL = 'hui:theme-mode';
const THEME_FILE = 'appearance.json';
const SEED_CHANNEL = 'hui:appearance-seed';
const SEED_CONSUMED_CHANNEL = 'hui:appearance-seed-consumed';
const SEED_FILE = 'desktop-appearance.json';
/** What the window chrome is in now, and what the next launch starts in before the page reports again. */
let themeSourceNow = 'system';

function themeFilePath() {
  return path.join(app.getPath('userData'), THEME_FILE);
}

/** What the page stored on this device last launch, or nothing when it stored none. */
function savedThemeMode() {
  try {
    return themeSource(JSON.parse(readFileSync(themeFilePath(), 'utf8'))?.themeMode);
  } catch {
    return undefined;
  }
}

/** Where the gateway keeps its own config: the same rule as `server/paths.ts`, which this shell cannot import. */
function gatewayConfigDir() {
  if (process.env.HUI_CONFIG_DIR) return process.env.HUI_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || app.getPath('home'), '.config');
  return path.join(base, 'hui');
}

function seedFilePath() {
  return path.join(gatewayConfigDir(), SEED_FILE);
}

/** The seed `hui doctor --fix` wrote, while nothing has consumed it; null otherwise. A seed this HUI cannot read, or
 * one already applied, is no seed. */
function pendingSeed() {
  try {
    const seed = JSON.parse(readFileSync(seedFilePath(), 'utf8'));
    if (seed?.format !== 1 || !seed.appearance || typeof seed.appearance !== 'object' || seed.consumedAt) return null;
    return seed;
  } catch {
    return null;
  }
}

/** Marks the seed consumed: one file that says what happened, kept beside the look it carried, so a launch that read
 * it and a person reading the directory both see it was used. */
function consumeSeed() {
  const seed = pendingSeed();
  if (!seed) return false;
  try {
    writeFileSync(seedFilePath(), JSON.stringify({ ...seed, consumedAt: new Date().toISOString() }, null, 2) + '\n');
    return true;
  } catch {
    // An unwritable directory only costs the marker: the page applied the look and stored it as this device's own.
    return false;
  }
}

/** The page's report: apply it now, and keep it for the next launch. A value that is not a mode reads as 'system'. */
function reportThemeMode(mode) {
  themeSourceNow = themeSource(mode);
  nativeTheme.themeSource = themeSourceNow;
  try {
    writeFileSync(themeFilePath(), JSON.stringify({ themeMode: themeSourceNow }));
  } catch {
    // A read-only userData only costs the next launch its first paint; the page reports again.
  }
  return themeSourceNow;
}

function showWindow(destination) {
  if (!url) return;
  const target = typeof destination === 'string' ? destination : undefined;
  if (window && !window.isDestroyed()) {
    if (target) void window.loadURL(target).catch((error) => {
      if (error.code !== 'ERR_ABORTED') dialog.showErrorBox('HUI could not open the chat', error.message);
    });
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    title: 'HUI', width: 1280, height: 850, minWidth: 360, minHeight: 480,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#fafaf9', show: false,
    // The sandboxed preload is the page's only channel: it reports this device's colour mode, nothing else.
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
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
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = undefined; });
  void window.loadURL(target ?? url).catch((error) => {
    if (error.code === 'ERR_ABORTED') return;
    dialog.showErrorBox('HUI could not open', error.message);
    app.quit();
  });
}

/** Only the window this shell opened may set its chrome or use its seed; anything else in the process is not the page. */
function fromWindow(event) {
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents);
}

function bannerChat(id) {
  const target = typeof id === 'string' && chatUrl(id.split('#')[0]);
  return target && isInternal(target, new URL(url).origin) ? target : undefined;
}

function inFront(chat) {
  return Boolean(window && !window.isDestroyed() && window.isFocused() && window.webContents.getURL().split(/[?#]/)[0] === chat);
}

function track(banner, target) {
  notifications.add(banner);
  banner.on('click', () => showWindow(target));
  banner.once('close', () => notifications.delete(banner));
}

function flushNotifications() {
  if (!url) return;
  for (const request of pendingNotifications.splice(0)) {
    const acknowledge = (status) => fetch(new URL(status, request.replyTo), { method: 'POST', signal: AbortSignal.timeout(5_000) }).catch(() => {});
    if (!isInternal(request.url, new URL(url).origin)) { void acknowledge('wrong-gateway'); continue; }
    if (!Notification.isSupported()) { void acknowledge('unsupported'); continue; }
    if (inFront(request.url)) { void acknowledge('in-view'); continue; }
    const notification = new Notification({
      id: `${request.url}#${randomUUID()}`, title: request.title, subtitle: request.subtitle, body: request.message,
      silent: request.priority === 'low',
    });
    track(notification, request.url);
    notification.once('failed', () => {
      notifications.delete(notification);
      void acknowledge('failed');
    });
    notification.once('show', () => {
      if (request.priority === 'high') app.dock?.bounce('critical');
      void acknowledge('queued');
    });
    notification.show();
  }
}

async function start() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', showWindow);
  app.on('open-url', (event, link) => {
    event.preventDefault();
    const chat = appChatPath(link);
    if (chat) {
      launchedFromChatLink = chat;
      if (url) showWindow(new URL(chat, url).href);
      return;
    }
    const request = notificationFromUrl(link);
    if (!request) return;
    if (!app.isReady()) launchedForNotification = true;
    pendingNotifications.push(request);
    flushNotifications();
  });
  app.on('activate', showWindow);
  app.once('ready', (_event, launchInfo) => { launchedFromBanner = launchInfo?.identifier; });
  // Closing a window must not interrupt agent runs. Quit is explicit.
  app.on('window-all-closed', () => {});
  await app.whenReady();
  session.defaultSession.on('will-download', (event, item) => {
    const options = { defaultPath: path.join(app.getPath('downloads'), item.getFilename()) };
    const target = window ? dialog.showSaveDialogSync(window, options) : dialog.showSaveDialogSync(options);
    if (target) item.setSavePath(target);
    else item.cancel();
  });
  // Electron asks macOS for notification permission when its first notification call creates the presenter, and an
  // alert sent while that prompt is open is never shown, so ask at launch:
  // https://github.com/electron/electron/blob/v44.4.5/shell/browser/notifications/mac/notification_presenter_mac.mm
  Notification.isSupported();
  // Only the window this shell opened may set the mode; anything else in the process is not the page.
  ipcMain.on(THEME_CHANNEL, (event, mode) => {
    if (!fromWindow(event)) return;
    reportThemeMode(mode);
  });
  ipcMain.handle(SEED_CHANNEL, (event) => (fromWindow(event) ? pendingSeed() : null));
  ipcMain.on(SEED_CONSUMED_CHANNEL, (event) => {
    if (!fromWindow(event)) return;
    consumeSeed();
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'HUI', submenu: [{ label: 'Show HUI', click: showWindow }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, viewMenu, { role: 'windowMenu' },
  ]));
  try {
    const config = JSON.parse(process.env.HUI_DESKTOP_LAUNCH || readFileSync(path.join(app.getAppPath(), 'launch.json'), 'utf8'));
    // Before the window exists, so its background is painted in the mode this device last chose, or in the one an
    // exported seed names on a device that never chose.
    themeSourceNow = savedThemeMode() ?? themeSource(pendingSeed()?.appearance?.themeMode) ?? 'system';
    nativeTheme.themeSource = themeSourceNow;
    const output = await new Promise((resolve, reject) => {
      execFile(config.node, [path.join(config.root, 'bin/hui.mjs'), 'gateway', 'start', '--json'], {
        cwd: app.getPath('home'), env: { ...process.env, PATH: config.searchPath || process.env.PATH },
        timeout: 30000, maxBuffer: 1024 * 1024,
      }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    const leftBanners = await Notification.getHistory();
    // The existing CLI authenticates gateway identity and prevents duplicates.
    // Closing or quitting the UI must never stop a shared gateway or its jobs.
    url = gatewayUrl(output);
    for (const banner of leftBanners) track(banner, bannerChat(banner.id));
    flushNotifications();
    const bannerTarget = bannerChat(launchedFromBanner);
    const chatTarget = launchedFromChatLink && new URL(launchedFromChatLink, url).href;
    if (chatTarget || bannerTarget || !launchedForNotification) showWindow(chatTarget ?? bannerTarget);
  } catch (error) {
    dialog.showErrorBox('HUI could not start', `${error.message}\nReinstall the npm package or run hui install-app to repair the launcher.`);
    app.quit();
  }
}

void start();
