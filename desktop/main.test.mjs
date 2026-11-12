import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { test } from "vitest";
import policy from './policy.cjs';

const receipt = `http://127.0.0.1:12345/${'a'.repeat(64)}/`;
const notificationUrl = (payload) => `hui-notification:${encodeURIComponent(typeof payload === 'string' ? payload : JSON.stringify(payload))}`;

const leftBanner = (id) => Object.assign(new EventEmitter(), { id });
const fakeDownload = (filename) => ({
  getFilename: () => filename, saved: undefined, cancelled: false,
  setSavePath(target) { this.saved = target; }, cancel() { this.cancelled = true; },
});
const bannerIds = async (t, ...chats) => {
  const writer = await shell(t);
  writer.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await writer.settle();
  for (const url of chats) writer.openUrl(notificationUrl({ title: 'Ready', message: 'Open this chat.', url, replyTo: receipt }));
  return writer.notifications.map((notification) => notification.options.id);
};

async function shell(t, settings = { themeMode: 'system' }, launchUrls = [], delivered = [], saved = new Map()) {
  const app = new EventEmitter();
  const windows = [];
  const errors = [];
  const notifications = [];
  const notificationReceipts = [];
  /** Every link the shell handed to the system browser. */
  const externals = [];
  /** Every identity request the shell made. */
  const probes = [];
  /** What the fixture gateway at an address answers the identity handshake. */
  const gatewayAnswers = new Map();
  const config = { root: '/fixture/package', node: '/fixture/node', searchPath: '/fixture/bin' };
  let launchArgs;
  let complete;
  let quits = 0;
  let loadFailure;
  let refusal;
  const startup = [];
  const bounces = [];
  const nativeTheme = { shouldUseDarkColors: false, themeSource: 'dark' };
  const settingsRequests = [];
  const saveDialogs = [];
  const themeReports = [];
  const ipcChannels = new Map();
  let saveChoice = '';
  const downloads = new EventEmitter();
  let onSettingsCompleted;
  let applicationMenu;
  app.setName = app.setPath = () => {};
  app.getPath = (name) => (name === 'downloads' ? '/fixture/downloads' : '/fixture/home');
  app.requestSingleInstanceLock = () => true;
  let ready = false;
  app.whenReady = () => new Promise((resolve) => setImmediate(() => { ready = true; resolve(); }));
  app.isReady = () => ready;
  app.quit = () => { quits++; };
  app.dock = { bounce: (type) => { bounces.push(type); } };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new EventEmitter();
      // The window's own history, which the View menu steps back and forward through: a step shows that page again
      // and reports it the way Electron does, because the shell follows `did-navigate` to know its gateway.
      this.entries = [];
      this.at = -1;
      this.webContents.navigationHistory = {
        canGoBack: () => this.at > 0,
        canGoForward: () => this.at >= 0 && this.at < this.entries.length - 1,
        goBack: () => { if (this.at > 0) this.at -= 1; this.showPage(); },
        goForward: () => { if (this.at < this.entries.length - 1) this.at += 1; this.showPage(); },
      };
      this.webContents.setWindowOpenHandler = (handler) => { this.webContents.windowOpenHandler = handler; };
      this.webContents.setVisualZoomLevelLimits = async (...limits) => { this.webContents.zoomLimits = limits; };
      this.webContents.session = { setPermissionRequestHandler(handler) { this.permission = handler; } };
      this.webContents.getURL = () => this.url ?? '';
      windows.push(this);
    }
    isDestroyed() { return false; }
    isMinimized() { return false; }
    show() { this.visible = true; }
    focus() { this.focused = true; }
    isFocused() { return this.focused === true; }
    blur() { this.focused = false; }
    /** The page this window shows now, and the report Electron sends whenever that changes. */
    showPage() {
      this.url = this.entries[this.at];
      this.webContents.emit('did-navigate', { preventDefault() {} }, this.url);
    }
    async loadURL(url) {
      if (loadFailure) { const error = loadFailure; loadFailure = undefined; throw error; }
      this.entries = this.entries.slice(0, this.at + 1);
      this.entries.push(url);
      this.at = this.entries.length - 1;
      this.showPage();
    }
  }
  class NativeNotification extends EventEmitter {
    static isSupported() { startup.push('notification permission'); return true; }
    static async getHistory() { return delivered; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() { this.shown = true; if (refusal) this.emit('failed', {}, refusal); else this.emit('show'); }
  }
  const dialog = { showErrorBox: (...args) => errors.push(args), showSaveDialogSync: (...args) => { saveDialogs.push(args); return saveChoice; } };
  const ipcMain = {
    on: (channel, handler) => { ipcChannels.set(channel, { kind: 'on', handler }); },
    handle: (channel, handler) => { ipcChannels.set(channel, { kind: 'handle', handler }); },
  };
  const electron = { app, BrowserWindow: Window, Notification: NativeNotification, dialog, ipcMain, session: { defaultSession: downloads }, Menu: { buildFromTemplate: (menu) => menu, setApplicationMenu(menu) { applicationMenu = menu; } }, nativeTheme, shell: { openExternal: async (target) => { externals.push(target); } } };
  // The shell's own userData, in memory: a path it writes survives into the next launch this test starts.
  const files = saved;
  const missing = (name) => Object.assign(new Error(`ENOENT: ${name}`), { code: 'ENOENT' });
  const fileSystem = {
    readFileSync: (name) => { if (!files.has(name)) throw missing(name); return files.get(name); },
    writeFileSync: (name, body) => { files.set(name, String(body)); },
  };
  const modules = { electron, 'node:child_process': { execFile: (...args) => { startup.push('gateway'); launchArgs = args; complete = args[3]; } }, 'node:crypto': crypto, 'node:fs': fileSystem, 'node:path': path, './policy.cjs': policy };
  t.onTestFinished(() => {});
  vm.runInNewContext(await readFile(new URL('./main.cjs', import.meta.url), 'utf8'), {
    require: (name) => modules[name], URL, AbortSignal, __dirname: '/fixture/desktop',
    fetch: async (url, init = {}) => {
      if (init.method === 'POST') { notificationReceipts.push(String(url)); return { ok: true }; }
      const target = String(url);
      // The identity handshake a gateway answers: what a probe reads. Everything else is a settings read.
      if (target.endsWith('/__hui/update')) {
        probes.push({ url: target, headers: init.headers });
        const body = gatewayAnswers.get(target);
        if (body === 'unreachable') throw new Error('connect ECONNREFUSED');
        if (body === 'html') return { ok: true, json: async () => { throw new Error('Unexpected token <'); } };
        return body ? { ok: true, json: async () => body } : { ok: false, json: async () => ({ error: 'not found' }) };
      }
      settingsRequests.push({ url: target, headers: init.headers });
      if (settings instanceof Error) throw settings;
      return { ok: true, json: async () => settings };
    },
    process: { env: { HUI_DESKTOP_LAUNCH: JSON.stringify(config) } },
  });
  for (const link of launchUrls) app.emit('open-url', { preventDefault() {} }, link);
  await new Promise(setImmediate);
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  return {
    app, windows, errors, notifications, notificationReceipts, launchArgs, nativeTheme, settingsRequests, settle, files, themeReports,
    externals, probes,
    /** What the fixture gateway at `base` answers the identity handshake. */
    answerGateway: (base, body = { currentVersion: '0.1.6', job: null, name: 'Elsewhere' }) => gatewayAnswers.set(`${base}/__hui/update`, body),
    /** An address nothing answers at all: a machine that is off, or not on this network. */
    unreachableGateway: (base) => gatewayAnswers.set(`${base}/__hui/update`, 'unreachable'),
    /** An address that answers with something that is not HUI at all. */
    otherApp: (base) => gatewayAnswers.set(`${base}/__hui/update`, 'html'),
    /** This device's gateway list, as the page reports it, and whether the window was the sender. */
    reportGateways: (links, sender = windows.at(-1)?.webContents) => ipcChannels.get('hui:gateways')?.handler({ sender }, links),
    /** The page asking the shell to switch, and what the shell answers. */
    openGateway: async (url, sender = windows.at(-1)?.webContents) => await ipcChannels.get('hui:open-gateway').handler({ sender }, url),
    /** The page following a link itself: a navigation on the window, and whether the shell blocked it. */
    follow: (target, event = 'will-navigate') => {
      let prevented = false;
      windows.at(-1).webContents.emit(event, { preventDefault() { prevented = true; } }, target);
      return prevented;
    },
    /** A link the page asks a new window for. */
    openInNewWindow: (target) => windows.at(-1).webContents.windowOpenHandler({ url: target }),
    /** A menu entry the operator chose, by its label. */
    clickMenu: (label) => applicationMenu.find((menu) => menu.label === 'View').submenu.find((item) => item.label === label).click(),
    /** The page reporting its mode, as `preload.cjs` sends it: from the window the shell opened. */
    reportThemeMode: (mode, sender = windows.at(-1)?.webContents) => ipcChannels.get('hui:theme-mode').handler({ sender }, mode),
    ipcChannel: () => [...ipcChannels.keys()].join(','),
    /** The page asking for the exported look, and telling the shell it landed. */
    appearanceSeed: async (sender = windows.at(-1)?.webContents) => await ipcChannels.get('hui:appearance-seed').handler({ sender }),
    consumeSeed: (sender = windows.at(-1)?.webContents) => ipcChannels.get('hui:appearance-seed-consumed').handler({ sender }),
    setSettings: (next) => { settings = next; },
    failNextLoad: (error) => { loadFailure = error; },
    refuseNotifications: (message) => { refusal = message; },
    bounces,
    saveDialogs,
    chooseSavePath: (target) => { saveChoice = target; },
    download: (item) => downloads.emit('will-download', { preventDefault() {} }, item, {}),
    openUrl: (link) => app.emit('open-url', { preventDefault() {} }, link),
    startup,
    complete: (...args) => complete(...args), quits: () => quits,
    menu: () => applicationMenu,
  };
}

test('desktop starts or reuses the managed gateway and keeps window lifecycle independent', async (t) => {
  const state = await shell(t);
  assert.equal(state.windows.length, 0);
  assert.equal(state.launchArgs[0], '/fixture/node');
  assert.deepEqual(Array.from(state.launchArgs[1]), ['/fixture/package/bin/hui.mjs', 'gateway', 'start', '--json']);
  assert.equal(state.launchArgs[2].env.PATH, '/fixture/bin');
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const window = state.windows[0];
  assert.equal(window.url, 'http://127.0.0.1:5174/');
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  state.app.emit('second-instance');
  assert.equal(window.focused, true);
  window.emit('closed');
  state.app.emit('window-all-closed');
  assert.equal(state.quits(), 0);
  state.app.emit('activate');
  assert.equal(state.windows.length, 2);
  state.app.quit();
  assert.equal(state.quits(), 1);
  assert.deepEqual(state.errors, []);
});

test('a download asks where to save it, starting in Downloads, and saves to the chosen path', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.chooseSavePath('/fixture/chosen/report.md');
  const item = fakeDownload('report.md');
  state.download(item);
  assert.equal(state.saveDialogs.length, 1);
  const [[parent, options]] = state.saveDialogs;
  assert.equal(parent, state.windows[0]);
  assert.equal(options.defaultPath, '/fixture/downloads/report.md');
  assert.equal(item.saved, '/fixture/chosen/report.md');
  assert.equal(item.cancelled, false);
  assert.deepEqual(state.errors, []);
});

test('cancelling the save dialog cancels the download', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const item = fakeDownload('report.md');
  state.download(item);
  assert.equal(item.cancelled, true);
  assert.equal(item.saved, undefined);
});

test('a download opens one save dialog, also after the window was closed and opened again', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.windows[0].emit('closed');
  state.app.emit('activate');
  state.chooseSavePath('/fixture/chosen/notes.txt');
  state.download(fakeDownload('notes.txt'));
  assert.equal(state.saveDialogs.length, 1);
  assert.equal(state.saveDialogs[0][0], state.windows[1]);
});

test('a download that starts with no window open still asks where to save it', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.windows[0].emit('closed');
  const item = fakeDownload('notes.txt');
  state.download(item);
  assert.equal(state.saveDialogs.length, 1);
  assert.equal(state.saveDialogs[0].length, 1);
  assert.equal(item.cancelled, true);
});

test('HUI asks macOS for notification permission at launch, not with the first alert', async (t) => {
  const state = await shell(t);
  assert.deepEqual(state.startup, ['notification permission', 'gateway']);
});

test('each notification opens its own chat on click without changing the active chat on delivery', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const alert = (url) => state.openUrl(notificationUrl({ title: 'Ready', message: 'Open this chat.', url, replyTo: receipt }));
  alert('http://127.0.0.1:5174/bots/stable-bot');
  alert('http://127.0.0.1:5174/sessions/session-a');
  assert.equal(state.notifications.length, 2);
  assert.equal(state.notifications.every((notification) => notification.shown), true);
  assert.deepEqual(state.notificationReceipts, Array(2).fill(`${receipt}queued`));
  assert.equal(state.windows[0].url, 'http://127.0.0.1:5174/');
  assert.equal(state.windows[0].focused, undefined);
  assert.equal(state.notifications[0].options.title, 'Ready');
  assert.equal(state.notifications[0].options.body, 'Open this chat.');
  state.notifications[0].emit('click');
  assert.equal(state.windows[0].url, 'http://127.0.0.1:5174/bots/stable-bot');
  assert.equal(state.windows[0].focused, true);
  state.notifications[1].emit('click');
  assert.equal(state.windows[0].url, 'http://127.0.0.1:5174/sessions/session-a');
  state.windows[0].emit('closed');
  state.notifications[0].emit('click');
  assert.equal(state.windows.length, 2);
  assert.equal(state.windows[1].url, 'http://127.0.0.1:5174/bots/stable-bot');
  assert.deepEqual(state.errors, []);
});

test('notification-only startup stays windowless and accepts another notification while the gateway starts', async (t) => {
  const payload = (id) => ({ title: 'Ready', message: 'Open this chat.', url: `http://127.0.0.1:5174/sessions/${id}`, replyTo: receipt });
  const state = await shell(t, { themeMode: 'system' }, [notificationUrl(payload('first'))]);
  state.openUrl(notificationUrl(payload('second')));
  assert.equal(state.notifications.length, 0);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  assert.equal(state.windows.length, 0);
  assert.equal(state.notifications.length, 2);
  state.notifications[0].emit('click');
  assert.equal(state.windows[0].url, 'http://127.0.0.1:5174/sessions/first');
  state.windows[0].emit('closed');
  state.notifications[1].emit('click');
  assert.equal(state.windows[1].url, 'http://127.0.0.1:5174/sessions/second');
});

test('an alert that arrives while the operator is opening HUI still lets the window open', async (t) => {
  const state = await shell(t);
  state.openUrl(notificationUrl({ title: 'Ready', message: 'Open this chat.', url: 'http://127.0.0.1:5174/sessions/a', replyTo: receipt }));
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  assert.equal(state.notifications.length, 1);
  assert.equal(state.windows.length, 1);
  assert.equal(state.windows[0].url, 'http://127.0.0.1:5174/');
});

test('a link that is not an alert does not keep HUI windowless when it launches HUI', async (t) => {
  const state = await shell(t, { themeMode: 'system' }, ['https://example.com/', notificationUrl('not JSON')]);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  assert.equal(state.windows.length, 1);
  assert.equal(state.notifications.length, 0);
});

test('hui:// chat links open the window on that chat, including one that launched HUI', async (t) => {
  const launched = await shell(t, { themeMode: 'system' }, ['hui://sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f']);
  launched.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await launched.settle();
  assert.equal(launched.windows.length, 1);
  assert.equal(launched.windows[0].url, 'http://127.0.0.1:5174/sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f');

  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.openUrl('hui://bots/scout');
  await state.settle();
  assert.equal(state.windows[0].url, 'http://127.0.0.1:5174/bots/scout');
});

test('a hui:// link cannot open another scheme, host or non-chat path', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const window = state.windows[0];
  for (const link of ['hui://sessions', 'hui://sessions/', 'hui://sessions/a/b', 'hui://files/a', 'hui://sessions/a?x=1', 'hui://sessions/a#x', 'https://example.com/sessions/a', 'hui-notification:{}', 'x://sessions/a']) {
    state.openUrl(link);
    await state.settle();
    assert.equal(window.url, 'http://127.0.0.1:5174/', link);
  }
});

test('hui:// chat paths keep the id they name and nothing else', () => {
  assert.equal(policy.appChatPath('hui://sessions/a%20b'), '/sessions/a%20b');
  assert.equal(policy.appChatPath('hui://bots/scout'), '/bots/scout');
  for (const link of ['hui://sessions/a%2Fb', 'hui://sessions/a?b=1', 'hui://user@sessions/a', 'hui://sessions/a#b', 'hui://sessionsSC/a', 'hui://sessions/']) {
    assert.equal(policy.appChatPath(link), undefined, link);
  }
});

test('a gateway page is its own origin under the path it is served at', () => {
  assert.equal(policy.gatewayBase('http://127.0.0.1:5174/'), 'http://127.0.0.1:5174');
  assert.equal(policy.gatewayBase('https://Example.test/hui///'), 'https://example.test/hui');
  for (const value of ['ftp://example.test', 'http://user:pass@example.test/', 'mailto:a@b', 'hui://sessions/a', 'not an address']) {
    assert.equal(policy.gatewayBase(value), undefined, value);
  }
  assert.equal(policy.isGatewayPage('http://127.0.0.1:5174/sessions/a', 'http://127.0.0.1:5174'), true);
  assert.equal(policy.isGatewayPage('http://127.0.0.1:5175/sessions/a', 'http://127.0.0.1:5174'), false);
  assert.equal(policy.isGatewayPage('https://example.test/hui/sessions/a', 'https://example.test/hui'), true);
  assert.equal(policy.isGatewayPage('https://example.test/huix', 'https://example.test/hui'), false, 'a path is not a prefix of a name');
  assert.equal(policy.isGatewayPage('https://example.test/', 'https://example.test/hui'), false);
});

test('only an address on this device\'s own network is asked whether it is a gateway', () => {
  for (const address of [
    'http://127.0.0.1:5174/sessions/a', 'http://192.168.1.4:8787', 'http://10.1.2.3:8787', 'http://172.16.4.2:8787',
    'http://100.64.0.10:8787', 'http://[::1]:5174/', 'http://[fd7a:115c:a1e0::1]:5174/',
    'http://studio:8787', 'https://studio.local/x', 'https://studio.local./x', 'https://build-box.tail1234.ts.net/sessions/a',
  ]) {
    assert.equal(policy.mayBeGateway(address), true, address);
  }
  // A public site is the browser's, including a public IP and a link-local metadata endpoint: nothing is asked there.
  for (const address of [
    'https://example.com/', 'https://hui.example.com/sessions/a', 'http://example.com/x', 'http://8.8.8.8/x',
    'http://169.254.169.254/latest/meta-data', 'http://[2606:4700::1111]/x',
    'mailto:a@b', 'hui://sessions/a', 'about:blank', 'file:///tmp/x',
  ]) {
    assert.equal(policy.mayBeGateway(address), false, address);
  }
});

test('a gateway served under a path is looked for behind the addresses above it', () => {
  assert.deepEqual(policy.gatewayCandidates('http://127.0.0.1:5174/sessions/a'), [
    'http://127.0.0.1:5174', 'http://127.0.0.1:5174/sessions', 'http://127.0.0.1:5174/sessions/a',
  ]);
  assert.deepEqual(policy.gatewayCandidates('https://example.test/hui/sessions/a', 3), [
    'https://example.test', 'https://example.test/hui', 'https://example.test/hui/sessions',
  ]);
  assert.deepEqual(policy.gatewayCandidates('not an address'), []);
});

test('only HUI\'s own update snapshot counts as a gateway handshake', () => {
  assert.equal(policy.isGatewayHandshake({ currentVersion: '0.1.6', job: null }), true);
  assert.equal(policy.isGatewayHandshake({ currentVersion: null, job: null, name: 'Studio' }), true);
  for (const body of [{ currentVersion: 6, job: null }, { job: null }, { currentVersion: '0.1.6' }, '<html>', null, [{ currentVersion: '0.1.6', job: null }]]) {
    assert.equal(policy.isGatewayHandshake(body), false, JSON.stringify(body));
  }
});

test('a switch is placed by the same rule as a link: a gateway this window knows, or one that answers', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const window = state.windows[0];

  // A page asking for a site this window cannot vouch for gets a no, and the page navigates itself instead.
  assert.equal(await state.openGateway('https://example.com/'), false);
  assert.equal(await state.openGateway('ftp://studio.local:8787'), false);
  assert.equal(await state.openGateway(42), false);
  assert.equal(await state.openGateway('https://example.com/', 'another frame'), false);
  assert.equal(window.url, 'http://127.0.0.1:5174/');
  assert.deepEqual(state.probes, [], 'a public site is not asked about, even when a page asks for it');

  // A gateway this device saved needs no identity request, and one on this network is asked once.
  state.reportGateways(['https://gateway.example/']);
  assert.equal(await state.openGateway('https://gateway.example'), true);
  assert.deepEqual(state.probes, []);
  state.answerGateway('http://192.168.1.4:8787');
  assert.equal(await state.openGateway('http://192.168.1.4:8787'), true);
  assert.deepEqual(state.probes.map((probe) => probe.url), ['http://192.168.1.4:8787/__hui/update']);
  assert.equal(window.url, 'http://192.168.1.4:8787');
  assert.deepEqual(state.externals, [], 'nothing here left the app');
});

test('switching gateway keeps the app\'s window, and both gateways stay HUI', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const window = state.windows[0];
  state.reportGateways(['http://studio.local:8787']);

  // The picker's switch asks the shell, which answers before the page would have navigated itself.
  assert.equal(await state.openGateway('http://studio.local:8787'), true);
  await state.settle();
  assert.equal(window.url, 'http://studio.local:8787');
  assert.deepEqual(state.externals, [], 'the browser is not asked');
  assert.deepEqual(state.probes, [], 'a gateway the page asked for needs no identity request');

  // A link to another gateway this device lists stays in the window too.
  state.reportGateways(['http://studio.local:8787', 'http://loft.local:8787']);
  assert.equal(state.follow('http://loft.local:8787/settings/connection'), true, 'the shell places the link itself');
  await state.settle();
  assert.equal(window.url, 'http://loft.local:8787/settings/connection');
  assert.deepEqual(state.probes, []);

  // The window is that gateway now, so its own pages navigate as usual.
  assert.equal(state.follow('http://loft.local:8787/sessions/a'), false);
  // And the gateways it came from are still its own.
  assert.equal(state.follow('http://127.0.0.1:5174/sessions/b'), true);
  await state.settle();
  assert.equal(window.url, 'http://127.0.0.1:5174/sessions/b');
  assert.deepEqual(state.externals, []);
});

test('only the window this shell opened may switch it or teach it a gateway', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  assert.equal(await state.openGateway('http://studio.local:8787', 'another frame'), false);
  state.reportGateways(['http://studio.local:8787'], 'another frame');
  assert.equal(state.follow('http://studio.local:8787/sessions/a'), true);
  await state.settle();
  assert.deepEqual(state.externals, ['http://studio.local:8787/sessions/a'], 'that gateway was never this window\'s to show');
  assert.equal(state.windows[0].url, 'http://127.0.0.1:5174/');
});

test('a gateway this device has not met yet is asked once, and a public site never is', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const window = state.windows[0];
  state.answerGateway('http://192.168.1.4:8787');

  assert.equal(state.follow('http://192.168.1.4:8787/sessions/a'), true);
  await state.settle();
  assert.equal(window.url, 'http://192.168.1.4:8787/sessions/a', 'it answered as HUI, so the window shows it');
  assert.deepEqual(state.probes.map((probe) => probe.url), ['http://192.168.1.4:8787/__hui/update']);
  assert.equal(state.probes[0].headers['x-hui'], '1');
  assert.deepEqual(state.externals, []);

  // Answered once, it is one of the gateways this window knows: a link back to it is placed without asking again.
  state.follow('http://127.0.0.1:5174/');
  await state.settle();
  assert.equal(state.follow('http://192.168.1.4:8787/bots/scout'), true);
  await state.settle();
  assert.equal(state.probes.length, 1);
  assert.equal(window.url, 'http://192.168.1.4:8787/bots/scout');

  // A public site is the browser's, and is never asked whether it is a gateway.
  assert.equal(state.follow('https://example.com/docs'), true);
  assert.equal(state.follow('http://example.com/insecure'), true);
  await state.settle();
  assert.deepEqual(state.externals, ['https://example.com/docs', 'http://example.com/insecure']);
  assert.equal(state.probes.length, 1);
  assert.equal(window.url, 'http://192.168.1.4:8787/bots/scout', 'the window stayed where it was');
});

test('an address nothing answers at opens in the browser, and is not asked again right away', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.unreachableGateway('http://192.168.1.9:8787');
  assert.equal(state.follow('http://192.168.1.9:8787/sessions/a'), true);
  await state.settle();
  assert.deepEqual(state.externals, ['http://192.168.1.9:8787/sessions/a']);
  assert.deepEqual(state.probes.map((probe) => probe.url), ['http://192.168.1.9:8787/__hui/update'], 'one request, not one per path');

  // The refusal stands a while, so a click on a page that is not a gateway does not ask again.
  state.follow('http://192.168.1.9:8787/sessions/b');
  await state.settle();
  assert.equal(state.probes.length, 1);
  assert.deepEqual(state.externals, ['http://192.168.1.9:8787/sessions/a', 'http://192.168.1.9:8787/sessions/b']);
});

test('a site that answers but is not HUI is left to the browser after its paths refuse', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  // A live machine with something else on every port HUI could be served at.
  assert.equal(state.follow('http://10.0.0.5:8000/app'), true);
  await state.settle();
  assert.deepEqual(state.externals, ['http://10.0.0.5:8000/app']);
  assert.deepEqual(state.probes.map((probe) => probe.url), [
    'http://10.0.0.5:8000/__hui/update', 'http://10.0.0.5:8000/app/__hui/update',
  ]);
});

test('a gateway served under a path is found behind another app on the same origin', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.otherApp('http://10.0.0.7:8080');
  state.answerGateway('http://10.0.0.7:8080/apps');
  assert.equal(state.follow('http://10.0.0.7:8080/apps/sessions/a'), true);
  await state.settle();
  assert.equal(state.windows[0].url, 'http://10.0.0.7:8080/apps/sessions/a');
  assert.deepEqual(state.externals, []);
  assert.deepEqual(state.probes.map((probe) => probe.url), [
    'http://10.0.0.7:8080/__hui/update', 'http://10.0.0.7:8080/apps/__hui/update',
  ]);

  // The gateway the window now shows is the one under the path, so its own pages navigate as usual.
  assert.equal(state.follow('http://10.0.0.7:8080/apps/settings'), false);
});

test('a hui:// link followed inside the window opens its chat there, on the gateway it shows', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const window = state.windows[0];
  assert.equal(state.follow('hui://sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f'), true);
  assert.equal(window.url, 'http://127.0.0.1:5174/sessions/4f0c2d9e-7a1b-4c3d-9e8f-0a1b2c3d4e5f');

  // A switch moves the chat links with the window: they name the gateway it is showing.
  state.reportGateways(['http://studio.local:8787']);
  state.follow('http://studio.local:8787/');
  await state.settle();
  state.follow('hui://bots/scout');
  assert.equal(window.url, 'http://studio.local:8787/bots/scout');
  assert.deepEqual(state.externals, []);
});

test('a page asking for a new window keeps its own gateway in the browser and another gateway in the app', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.reportGateways(['http://studio.local:8787']);
  state.follow('http://studio.local:8787/sessions/a');
  await state.settle();

  // "Open in new tab" on a page of the gateway on screen is still a browser tab, as it always was.
  assert.equal(state.openInNewWindow('http://studio.local:8787/__hui/media/one.png').action, 'deny');
  await state.settle();
  assert.deepEqual(state.externals, ['http://studio.local:8787/__hui/media/one.png']);
  assert.equal(state.windows.length, 1, 'no second window');
  assert.equal(state.windows[0].url, 'http://studio.local:8787/sessions/a', 'the app keeps the page it was showing');

  // A link to another gateway this device lists is placed in this window instead.
  assert.equal(state.openInNewWindow('http://127.0.0.1:5174/sessions/b').action, 'deny');
  await state.settle();
  assert.equal(state.windows.length, 1);
  assert.equal(state.windows[0].url, 'http://127.0.0.1:5174/sessions/b');

  state.openInNewWindow('https://example.com/docs');
  await state.settle();
  assert.deepEqual(state.externals, ['http://studio.local:8787/__hui/media/one.png', 'https://example.com/docs']);
});

test('a gateway this window only met through a handshake cannot steer it further', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.answerGateway('http://192.168.1.4:8787');
  assert.equal(state.follow('http://192.168.1.4:8787/sessions/a'), true);
  await state.settle();
  assert.equal(state.windows[0].url, 'http://192.168.1.4:8787/sessions/a');

  // Its page is on screen, but this device never listed it: it can neither report a gateway nor ask for one.
  state.reportGateways(['https://example.com']);
  assert.equal(await state.openGateway('https://example.com'), false);
  assert.equal(state.follow('https://example.com/'), true);
  await state.settle();
  assert.deepEqual(state.externals, ['https://example.com/'], 'the public site stayed the browser\'s');
  assert.equal(state.windows[0].url, 'http://192.168.1.4:8787/sessions/a');
});

test('a switch to a page under a gateway keeps that gateway, not the page, as the window\'s own', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.answerGateway('http://192.168.1.4:8787');
  assert.equal(await state.openGateway('http://192.168.1.4:8787/sessions/a'), true);
  await state.settle();
  assert.equal(state.windows[0].url, 'http://192.168.1.4:8787/sessions/a');

  // The chat a `hui://` link names is built on the gateway, not on the page the switch landed on.
  state.follow('hui://bots/scout');
  assert.equal(state.windows[0].url, 'http://192.168.1.4:8787/bots/scout');
  assert.equal(state.follow('http://192.168.1.4:8787/settings'), false, 'a sibling page is its own gateway\'s');
});

test('a switch whose page never loads leaves the window on the gateway it was showing', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const window = state.windows[0];
  state.reportGateways(['http://studio.local:8787']);
  state.failNextLoad(new Error('ERR_NAME_NOT_RESOLVED'));
  assert.equal(await state.openGateway('http://studio.local:8787'), true);
  await state.settle();
  assert.equal(window.url, 'http://127.0.0.1:5174/', 'the window still shows the gateway it had');
  assert.equal(state.errors.length, 1);

  // That gateway is still the one the window belongs to: its clipboard writes are its own.
  let granted;
  window.webContents.session.permission(window.webContents, 'clipboard-sanitized-write', (value) => { granted = value; });
  assert.equal(granted, true);
});

test('a banner from another gateway this device lists opens that gateway\'s chat in the window', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.reportGateways(['http://studio.local:8787']);
  state.openUrl(notificationUrl({ title: 'Ready', message: 'Open.', url: 'http://studio.local:8787/sessions/a', replyTo: receipt }));
  assert.equal(state.notifications.length, 1);
  assert.deepEqual(state.notificationReceipts, [`${receipt}queued`]);
  state.notifications[0].emit('click');
  assert.equal(state.windows[0].url, 'http://studio.local:8787/sessions/a');
});

test('permissions follow the gateway the window is showing', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.reportGateways(['http://studio.local:8787']);
  state.follow('http://studio.local:8787/sessions/a');
  await state.settle();
  const contents = state.windows[0].webContents;
  for (const permission of ['clipboard-sanitized-write', 'fullscreen']) {
    let granted;
    contents.session.permission(contents, permission, (value) => { granted = value; });
    assert.equal(granted, true, permission);
  }
  let granted;
  contents.session.permission({ getURL: () => 'https://example.com' }, 'clipboard-sanitized-write', (value) => { granted = value; });
  assert.equal(granted, false);
});

test('clicking a banner left by a crashed HUI launches HUI on its chat, but only on the same gateway', async (t) => {
  const [botBanner] = await bannerIds(t, 'http://127.0.0.1:5174/bots/stable-bot');
  for (const [identifier, gateway, opened] of [
    [botBanner, 'http://127.0.0.1:5174/', 'http://127.0.0.1:5174/bots/stable-bot'],
    [botBanner, 'http://127.0.0.1:5175/', 'http://127.0.0.1:5175/'],
    [crypto.randomUUID(), 'http://127.0.0.1:5174/', 'http://127.0.0.1:5174/'],
  ]) {
    const state = await shell(t);
    state.app.emit('ready', {}, { actionIdentifier: 'com.apple.UNNotificationDefaultActionIdentifier', identifier });
    state.complete(null, JSON.stringify({ status: 'running', url: gateway }));
    await state.settle();
    assert.equal(state.windows.length, 1);
    assert.equal(state.windows[0].url, opened);
  }
});

test('banners left by a crashed HUI stay separate and open their chat after HUI restarts', async (t) => {
  const [first, second] = await bannerIds(t, 'http://127.0.0.1:5174/sessions/left', 'http://127.0.0.1:5174/sessions/left');
  assert.notEqual(first, second);
  const left = [leftBanner(first), leftBanner(crypto.randomUUID())];
  const state = await shell(t, { themeMode: 'system' }, [], left);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.windows[0].emit('closed');
  left[1].emit('click');
  assert.equal(state.windows[1].url, 'http://127.0.0.1:5174/');
  left[0].emit('click');
  assert.equal(state.windows[1].url, 'http://127.0.0.1:5174/sessions/left');
  assert.equal(state.windows[1].focused, true);
});

test('notification URLs cannot open another origin, a non-chat path or executable URLs', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  for (const url of [
    'https://example.com/sessions/a', 'http://127.0.0.1:5175/sessions/a',
    'http://127.0.0.1:5174/settings', 'http://127.0.0.1:5174/sessions/a?url=other',
    'http://127.0.0.1:5174/sessions/a#other', 'http://user:password@127.0.0.1:5174/sessions/a',
    'http://127.0.0.1:5174/sessions/%E0%A4%A', 'javascript:alert(1)', 'file:///tmp/a',
  ]) {
    state.openUrl(notificationUrl({ title: 'Ready', message: 'Open.', url, replyTo: receipt }));
  }
  const receiptsBefore = state.notificationReceipts.length;
  for (const replyTo of ['https://example.com/receipt', 'http://localhost:12345/token/', 'file:///tmp/receipt']) {
    state.openUrl(notificationUrl({ title: 'Ready', message: 'Open.', url: 'http://127.0.0.1:5174/sessions/a', replyTo }));
  }
  for (const field of [{ priority: 'urgent' }, { subtitle: 'x'.repeat(121) }, { message: 'x'.repeat(1_001) }, { message: 42 }]) {
    state.openUrl(notificationUrl({ title: 'Ready', url: 'http://127.0.0.1:5174/sessions/a', replyTo: receipt, ...field }));
  }
  state.openUrl(notificationUrl('not JSON'));
  state.openUrl(`https://example.com/${encodeURIComponent(JSON.stringify({ title: 'Ready', message: 'Open.', url: 'http://127.0.0.1:5174/sessions/a', replyTo: receipt }))}`);
  assert.equal(state.notificationReceipts.length, receiptsBefore);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.windows[0].url, 'http://127.0.0.1:5174/');
});

test('cancelled chat navigation neither quits HUI nor shows an error when another chat is opened', async (t) => {
  const state = await shell(t);
  const aborted = () => Object.assign(new Error('navigation was replaced'), { code: 'ERR_ABORTED' });
  state.failNextLoad(aborted());
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  assert.equal(state.quits(), 0);
  state.openUrl(notificationUrl({ title: 'Ready', message: 'Open.', url: 'http://127.0.0.1:5174/sessions/a', replyTo: receipt }));
  state.failNextLoad(aborted());
  state.notifications[0].emit('click');
  await state.settle();
  assert.equal(state.quits(), 0);
  assert.deepEqual(state.errors, []);
});

test('the chat in front gets no banner; another chat, or the same one behind another app, gets one', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const alert = (url) => state.openUrl(notificationUrl({ title: 'Ready', url, replyTo: receipt }));
  await state.windows[0].loadURL('http://127.0.0.1:5174/sessions/a?pane=files');
  state.windows[0].focus();
  alert('http://127.0.0.1:5174/sessions/a');
  alert('http://127.0.0.1:5174/sessions/b');
  state.windows[0].blur();
  alert('http://127.0.0.1:5174/sessions/a');
  assert.deepEqual(state.notificationReceipts, [`${receipt}in-view`, `${receipt}queued`, `${receipt}queued`]);
  assert.equal(state.notifications.length, 2);
});

test('priority picks the sound and the Dock bounce, and the subtitle and message show as written', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  for (const priority of ['low', 'normal', 'high', undefined]) {
    state.openUrl(notificationUrl({ title: 'Ready', subtitle: ' Finished ', message: 'Body.', ...(priority ? { priority } : {}), url: 'http://127.0.0.1:5174/sessions/a', replyTo: receipt }));
  }
  assert.deepEqual(state.notifications.map(({ options }) => options.silent), [true, false, false, false]);
  assert.deepEqual(state.bounces, ['critical']);
  assert.deepEqual(state.notifications.map(({ options }) => [options.subtitle, options.body]), Array(4).fill(['Finished', 'Body.']));
});

test('a notification macOS refuses is reported as failed without a dialog or a window', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.windows[0].emit('closed');
  state.refuseNotifications('Notifications are not allowed for this application');
  state.openUrl(notificationUrl({ title: 'Ready', message: 'Open.', url: 'http://127.0.0.1:5174/sessions/a', replyTo: receipt }));
  assert.deepEqual(state.notificationReceipts, [`${receipt}failed`]);
  assert.deepEqual(state.errors, []);
  assert.equal(state.windows.length, 1);
});

test('gateway startup failure is visible rather than loading an unrelated page', async (t) => {
  const state = await shell(t);
  state.complete(new Error('Gateway could not be authenticated'));
  await new Promise(setImmediate);
  assert.equal(state.windows.length, 0);
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0][1], /could not be authenticated/);
  assert.equal(state.quits(), 1);
});

test('clipboard writes and fullscreen stay local and other renderer permissions remain denied', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const contents = state.windows[0].webContents;
  let granted;
  contents.session.permission(contents, 'clipboard-sanitized-write', (value) => { granted = value; });
  assert.equal(granted, true);
  contents.session.permission(contents, 'fullscreen', (value) => { granted = value; });
  assert.equal(granted, true);
  contents.session.permission(contents, 'media', (value) => { granted = value; });
  assert.equal(granted, false);
  contents.session.permission({ getURL: () => 'https://example.com' }, 'clipboard-sanitized-write', (value) => { granted = value; });
  assert.equal(granted, false);
});

test('the window chrome follows the mode the page reports, and the next launch starts in the one it kept', async (t) => {
  const saved = new Map();
  const state = await shell(t, undefined, [], [], saved);
  assert.equal(state.nativeTheme.themeSource, 'system', 'nothing kept yet');
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  assert.equal(state.ipcChannel(), 'hui:theme-mode,hui:appearance-seed,hui:appearance-seed-consumed,hui:gateways,hui:open-gateway', 'the bridges the preload exposes');
  assert.equal(state.windows[0].options.webPreferences.preload, path.join('/fixture/desktop', 'preload.cjs'));
  assert.equal(state.windows[0].options.webPreferences.sandbox, true, 'the preload does not lift the sandbox');
  assert.equal(state.windows[0].options.backgroundColor, '#fafaf9');
  assert.deepEqual(state.settingsRequests, [], 'the shell never asks the gateway what appearance this device has');

  state.reportThemeMode('dark');
  assert.equal(state.nativeTheme.themeSource, 'dark');
  assert.deepEqual(JSON.parse(saved.get('/fixture/home/appearance.json')), { themeMode: 'dark' });

  state.reportThemeMode('light');
  assert.equal(state.nativeTheme.themeSource, 'light');
  state.reportThemeMode('system');
  assert.equal(state.nativeTheme.themeSource, 'system');

  // A value that is not a mode is the OS's, as the page's own validator would have said.
  state.reportThemeMode('bogus');
  assert.equal(state.nativeTheme.themeSource, 'system');
  assert.deepEqual(JSON.parse(saved.get('/fixture/home/appearance.json')), { themeMode: 'system' });

  // Another frame in the process cannot set this window's chrome.
  state.reportThemeMode('dark', 'another frame');
  assert.equal(state.nativeTheme.themeSource, 'system');

  state.reportThemeMode('dark');
  const relaunched = await shell(t, undefined, [], [], saved);
  assert.equal(relaunched.nativeTheme.themeSource, 'dark', 'chosen before the window and the page exist');
  relaunched.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await relaunched.settle();
  assert.equal(relaunched.windows[0].options.backgroundColor, '#fafaf9');
});

test('an exported look is handed to the page once, and the page\'s confirmation marks it consumed', async (t) => {
  const saved = new Map();
  const seedPath = '/fixture/home/.config/hui/desktop-appearance.json';
  const seed = {
    format: 1, gateway: 'build-box', exportedAt: '2026-11-16T10:00:00.000Z',
    appearance: { theme: 'miami', themeMode: 'dark', accent: '#5b9cf6', fontUi: 'geist', fontChat: 'lora', fontTerminal: 'MesloLGS NF', textScale: 125 },
  };
  saved.set(seedPath, JSON.stringify(seed));
  const state = await shell(t, undefined, [], [], saved);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  // A device that never chose takes the seed's colour mode for its window before the page has loaded.
  assert.equal(state.nativeTheme.themeSource, 'dark');
  assert.deepEqual(JSON.parse(JSON.stringify(await state.appearanceSeed())), seed, 'the page reads the look the gateway exported');
  assert.deepEqual(await state.appearanceSeed('another frame'), null, 'another frame gets nothing');

  state.consumeSeed('another frame');
  assert.equal(JSON.parse(saved.get(seedPath)).consumedAt, undefined, 'another frame cannot consume it');
  state.consumeSeed();
  assert.match(JSON.parse(saved.get(seedPath)).consumedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(JSON.parse(saved.get(seedPath)).appearance.theme, 'miami', 'the look it carried stays readable');
  assert.deepEqual(await state.appearanceSeed(), null, 'a consumed seed is never offered again');
});

test('a seed this shell cannot read, or one consumed already, leaves the window in the mode the device stored', async (t) => {
  const saved = new Map();
  const seedPath = '/fixture/home/.config/hui/desktop-appearance.json';
  const modePath = '/fixture/home/appearance.json';
  saved.set(modePath, JSON.stringify({ themeMode: 'light' }));
  for (const body of ['{ not json', JSON.stringify({ format: 2, appearance: { themeMode: 'dark' } }), JSON.stringify({ format: 1, appearance: 'miami' }), JSON.stringify({ format: 1, appearance: { themeMode: 'dark' }, consumedAt: '2026-11-16T11:00:00.000Z' })]) {
    saved.set(seedPath, body);
    const state = await shell(t, undefined, [], [], saved);
    state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
    await state.settle();
    assert.equal(state.nativeTheme.themeSource, 'light', body);
    assert.deepEqual(await state.appearanceSeed(), null, body);
    state.windows[0].emit('closed');
  }
});

test('a userData directory that refuses the write still lets the page set the chrome now', async (t) => {
  const state = await shell(t, undefined, [], [], {
    has: () => false,
    get: () => undefined,
    set: () => { throw new Error('read-only'); },
  });
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  state.reportThemeMode('dark');
  assert.equal(state.nativeTheme.themeSource, 'dark');
  assert.deepEqual(state.errors, []);
});

test('the window can step back from a gateway it was switched to, and back again', async (t) => {
  const state = await shell(t);
  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const window = state.windows[0];
  state.reportGateways(['http://studio.local:8787']);
  assert.equal(await state.openGateway('http://studio.local:8787'), true);
  await state.settle();
  assert.equal(window.url, 'http://studio.local:8787');

  state.clickMenu('Back');
  assert.equal(window.url, 'http://127.0.0.1:5174/', 'the gateway it came from is a page to go back to');
  // The window belongs to the gateway it is showing again: its clipboard writes are its own.
  let granted;
  window.webContents.session.permission(window.webContents, 'clipboard-sanitized-write', (value) => { granted = value; });
  assert.equal(granted, true);

  state.clickMenu('Forward');
  assert.equal(window.url, 'http://studio.local:8787');
  state.clickMenu('Forward');
  assert.equal(window.url, 'http://studio.local:8787', 'nothing forward of the newest page');
  state.clickMenu('Back');
  state.clickMenu('Back');
  assert.equal(window.url, 'http://127.0.0.1:5174/', 'nothing back of the oldest page');
  assert.deepEqual(state.errors, []);
});

test('zoom follows macOS conventions: Cmd+= zooms in and trackpad pinch is enabled', async (t) => {  const state = await shell(t);
  const view = state.menu().find((menu) => menu.label === 'View');
  const zoomIn = view.submenu.filter((item) => item.role === 'zoomIn');
  assert.equal(zoomIn.filter((item) => item.visible !== false).length, 1, 'one visible Zoom In entry');
  const equals = zoomIn.find((item) => item.accelerator === 'CommandOrControl+=');
  assert.equal(equals?.visible, false);
  assert.equal(equals?.acceleratorWorksWhenHidden, true);
  for (const role of ['resetZoom', 'zoomOut', 'reload', 'toggleDevTools', 'togglefullscreen']) {
    assert.ok(view.submenu.some((item) => item.role === role), `keeps ${role}`);
  }

  state.complete(null, JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5174/' }));
  await state.settle();
  const contents = state.windows[0].webContents;
  assert.equal(contents.zoomLimits, undefined);
  contents.emit('did-finish-load');
  assert.deepEqual(Array.from(contents.zoomLimits), [1, 3]);
  contents.zoomLimits = undefined;
  contents.emit('did-finish-load');
  assert.deepEqual(Array.from(contents.zoomLimits), [1, 3], 'reapplied after reload');
});
