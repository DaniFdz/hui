/** Electron window shell around the gateway's web UI. It starts or reuses the gateway through the installed CLI, shows
 * one sandboxed window on this device's gateways and hands every other link to the system browser. Closing or quitting
 * the window never stops the gateway or its runs. Native notification clicks open their originating chat, and so does
 * a `hui://sessions/<id>` link, which is what the web app's `?open=app` hand-off and any launcher send. Every download
 * asks where to save it, because Electron would otherwise save it straight into Downloads.
 *
 * The window belongs to the gateways this device knows, not to one origin: switching gateway from the page, or
 * following a link to another gateway on this network, loads that gateway in the same window instead of handing it to
 * the browser. A page reports the gateways this device saved, and an address on this device's own network is asked
 * the identity handshake `GET /__hui/update` answers before the window trusts it. Permission follows the gateway now
 * shown, so the thing that changes with a switch is only the gateway the window is showing.
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
const {
  isExternal, gatewayUrl, themeSource, chatUrl, appChatPath, notificationFromUrl,
  gatewayBase, isGatewayPage, mayBeGateway, gatewayCandidates, isGatewayHandshake,
} = require('./policy.cjs');

app.setName('HUI');
// CLI and installed bundle use the same lock, cookies and IndexedDB location.
app.setPath('userData', path.join(app.getPath('appData'), 'HUI'));
let window;
let url;
/**
 * The gateways this window may show itself. `listed` is what the page last reported from this device's list, replaced
 * whole each time so a gateway the operator removed stops being trusted; `verified` holds the gateway the CLI started,
 * the ones an identity probe accepted and the ones this window has shown, evicted oldest first. A page of one of them
 * stays in the window; every other link is the browser's.
 */
let listedGateways = new Set();
const verifiedGateways = new Set();
/** The gateway the window is showing: what a `hui://` chat link names, and whose permissions the window grants. */
let currentGateway = '';
/** What an identity probe heard from an address, and when, so a refusal is retried later and a yes never again. */
const gatewayProbes = new Map();
const pendingNotifications = [];
const notifications = new Set();
let launchedForNotification = false;
let launchedFromBanner;
/** A `hui://` chat link that arrived before the gateway address was known. */
let launchedFromChatLink;

// Electron's default viewMenu binds Zoom In to CommandOrControl+Plus only, which
// needs Shift on US layouts, so the browser-standard Cmd/Ctrl+= does nothing.
// The hidden item keeps that shortcut without a duplicate visible entry.
// Back and Forward are the window's own history, which now holds the gateways it
// was switched between: an unreachable one is a page to leave, not a dead end.
const viewMenu = {
  label: 'View',
  submenu: [
    { label: 'Back', accelerator: 'CommandOrControl+Shift+[', click: () => stepHistory(-1) },
    { label: 'Forward', accelerator: 'CommandOrControl+Shift+]', click: () => stepHistory(1) },
    { type: 'separator' },
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
/** What the page reports from this device's gateway list, so a link to one of them stays in the window. */
const GATEWAY_CHANNEL = 'hui:gateways';
/** The page asking, and waiting to hear, that a switch is on its way: a switch must never depend on IPC timing. */
const OPEN_GATEWAY_CHANNEL = 'hui:open-gateway';
/** Bounds what a page can teach this window: this device's own list is far shorter. */
const MAX_GATEWAYS = 32;
/** One identity request to an address on this network. A gateway answers in milliseconds; a dead address doesn't. */
const GATEWAY_PROBE_TIMEOUT_MS = 4_000;
/** How long a refusal stands before the next link to that address asks again. */
const GATEWAY_REFUSAL_MS = 30_000;
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

/** The gateway base a URL belongs to, when this window knows it: the longest match wins, so a gateway served under a
 * path is matched before the origin above it. */
function knownGateway(target) {
  let found = '';
  for (const base of [...verifiedGateways, ...listedGateways]) {
    if (base.length > found.length && isGatewayPage(target, base)) found = base;
  }
  return found || undefined;
}

/** Teaches the window a gateway it may show, keeping the newest `MAX_GATEWAYS` of them. */
function rememberGateway(value) {
  const base = gatewayBase(value);
  if (!base) return undefined;
  verifiedGateways.delete(base);
  verifiedGateways.add(base);
  for (const oldest of verifiedGateways) {
    if (verifiedGateways.size <= MAX_GATEWAYS) break;
    verifiedGateways.delete(oldest);
  }
  return base;
}

/** Replaces what the page reported: the list belongs to the page showing it, so a gateway it dropped is forgotten. */
function reportedGateways(links) {
  const next = new Set();
  for (const link of links.slice(0, MAX_GATEWAYS)) {
    const base = typeof link === 'string' ? gatewayBase(link) : undefined;
    if (base) next.add(base);
  }
  listedGateways = next;
}

/** Whether an address answers the identity handshake `GET /__hui/update` carries: a gateway, another app, or nothing
 * at all — which is what decides whether an address further along a path is worth asking. */
async function identityOf(base) {
  let response;
  try {
    response = await fetch(`${base}/__hui/update`, {
      headers: { 'x-hui': '1' }, cache: 'no-store', signal: AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS),
    });
  } catch {
    return 'unreachable';
  }
  if (!response.ok) return 'answered';
  // A page that is not JSON is another app answering, not a machine that is absent: a gateway further along the path
  // may still be this one.
  const body = await response.json().catch(() => undefined);
  return isGatewayHandshake(body) ? 'gateway' : 'answered';
}

/** The base of the gateway `target` belongs to, asking an address on this device's own network once. */
async function detectGateway(target) {
  if (!mayBeGateway(target)) return undefined;
  for (const base of gatewayCandidates(target)) {
    const probe = gatewayProbes.get(base);
    if (probe && (probe.gateway || Date.now() - probe.at < GATEWAY_REFUSAL_MS)) {
      if (probe.gateway) return base;
      if (probe.unreachable) return undefined;
      continue;
    }
    const identity = await identityOf(base);
    const gateway = identity === 'gateway';
    gatewayProbes.set(base, { gateway, unreachable: identity === 'unreachable', at: Date.now() });
    if (gateway) return rememberGateway(base);
    // A machine that does not answer its origin at all is not serving a gateway under a path either.
    if (identity === 'unreachable') return undefined;
  }
  return undefined;
}

/** Steps the window's own history, which holds the gateways it was switched between. */
function stepHistory(step) {
  if (!window || window.isDestroyed()) return;
  const history = window.webContents.navigationHistory;
  if (step < 0 ? history.canGoBack() : history.canGoForward()) {
    if (step < 0) history.goBack();
    else history.goForward();
  }
}

/** Shows a page in this window, which becomes the gateway it belongs to. */
function loadInWindow(target, base) {
  if (!window || window.isDestroyed()) return;
  currentGateway = rememberGateway(base) ?? base;
  void window.loadURL(target).catch((error) => {
    if (error.code !== 'ERR_ABORTED') dialog.showErrorBox('HUI could not open the page', error.message);
  });
}

/** The one place a link leaves HUI: web and mail addresses, and nothing this window said it could show. */
function openExternal(target) {
  if (isExternal(target)) void shell.openExternal(target).catch(() => {});
}

/**
 * Follows a link this window cannot show by itself. A `hui://` chat link opens its chat here, a page of a gateway this
 * device knows opens here at once, a gateway this device has not met yet is asked first, and everything else — a web
 * page, mail, a file — goes to the system browser. HUI's own pages therefore have priority over the browser.
 */
async function follow(target) {
  const chat = appChatPath(target);
  if (chat && currentGateway) {
    loadInWindow(`${currentGateway}${chat}`, currentGateway);
    return;
  }
  const known = knownGateway(target);
  if (known) {
    loadInWindow(target, known);
    return;
  }
  const detected = await detectGateway(target);
  if (detected) {
    loadInWindow(target, detected);
    return;
  }
  openExternal(target);
}

function showWindow(destination) {
  if (!url) return;
  const target = typeof destination === 'string' ? destination : undefined;
  if (window && !window.isDestroyed()) {
    if (target) {
      currentGateway = knownGateway(target) ?? currentGateway;
      void window.loadURL(target).catch((error) => {
        if (error.code !== 'ERR_ABORTED') dialog.showErrorBox('HUI could not open the chat', error.message);
      });
    }
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
  currentGateway = knownGateway(target ?? url) ?? gatewayBase(url) ?? '';
  // The window belongs to whichever gateway it is showing, including one a history step went back to.
  window.webContents.on('did-navigate', (_event, target) => {
    currentGateway = knownGateway(target) ?? gatewayBase(target) ?? currentGateway;
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    // A page of the gateway on screen asking for a window keeps the browser tab it always got, which is what its
    // "Open in new tab" promises; a link to another gateway is placed by the rule every other link follows.
    if (isGatewayPage(target, currentGateway)) openExternal(target);
    else void follow(target);
    return { action: 'deny' };
  });
  for (const event of ['will-navigate', 'will-redirect']) {
    window.webContents.on(event, (e, target) => {
      // This gateway's own pages navigate as usual; anything else is placed again, in this window when it is HUI's.
      if (isGatewayPage(target, currentGateway)) return;
      e.preventDefault();
      void follow(target);
    });
  }
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('did-finish-load', () => {
    void window?.webContents.setVisualZoomLevelLimits(...PINCH_ZOOM_LIMITS).catch(() => {});
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(['clipboard-sanitized-write', 'fullscreen'].includes(permission) && isGatewayPage(contents.getURL(), currentGateway));
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

/** The chat a banner names, when it belongs to a gateway this window may show: a banner is never a way out of HUI. */
function bannerChat(id) {
  const target = typeof id === 'string' && chatUrl(id.split('#')[0]);
  return target && knownGateway(target) ? target : undefined;
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
    if (!knownGateway(request.url)) { void acknowledge('wrong-gateway'); continue; }
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
      if (currentGateway) showWindow(`${currentGateway}${chat}`);
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
  // The gateways this device lists: a switch to one of them, or a link to one, then stays in this window.
  ipcMain.on(GATEWAY_CHANNEL, (event, links) => {
    if (!fromWindow(event) || !Array.isArray(links)) return;
    reportedGateways(links);
  });
  // A switch, asked for by the page and answered before it navigates. It is placed by the same rule a link follows:
  // a gateway this window knows, or one on this device's own network that answers as HUI.
  ipcMain.handle(OPEN_GATEWAY_CHANNEL, async (event, link) => {
    if (!fromWindow(event) || typeof link !== 'string') return false;
    const base = gatewayBase(link);
    if (!base) return false;
    if (!knownGateway(base) && !(await detectGateway(base))) return false;
    loadInWindow(isGatewayPage(link, base) ? link : base, base);
    return true;
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
    currentGateway = rememberGateway(url) ?? '';
    for (const banner of leftBanners) track(banner, bannerChat(banner.id));
    flushNotifications();
    const bannerTarget = bannerChat(launchedFromBanner);
    const chatTarget = launchedFromChatLink && `${currentGateway}${launchedFromChatLink}`;
    if (chatTarget || bannerTarget || !launchedForNotification) showWindow(chatTarget ?? bannerTarget);
  } catch (error) {
    dialog.showErrorBox('HUI could not start', `${error.message}\nReinstall the npm package or run hui install-app to repair the launcher.`);
    app.quit();
  }
}

void start();
