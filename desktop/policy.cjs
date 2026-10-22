/** Pure decisions for the desktop shell, kept apart from the Electron process code: which URLs stay in the window,
 * which open externally, validated notification destinations, gateway addresses and the saved color scheme. */
const { URL } = require('node:url');
const { isIP } = require('node:net');

function isInternal(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

function isExternal(url) {
  // vscode: only opens a file; its other handlers (clone, extension URIs) stay blocked.
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(url).protocol) || url.startsWith('vscode://file/'); }
  catch { return false; }
}

function gatewayUrl(output) {
  const status = JSON.parse(output);
  const url = new URL(status.url);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (status.status !== 'running' || url.protocol !== 'http:' || !isIP(host) || url.username || url.password) {
    throw new Error('The managed gateway did not return a valid local address.');
  }
  return url.href;
}

function themeSource(mode) {
  return mode === 'light' || mode === 'dark' ? mode : 'system';
}

// Electron hands a running app the second instance's argv with switches first and its own switches added, so the
// payload travels inside the switch: https://www.electronjs.org/docs/latest/api/app#event-second-instance
const NOTIFICATION_SWITCH = '--hui-notification=';

function notificationFromArgs(args = []) {
  const payload = args.find((arg) => arg.startsWith(NOTIFICATION_SWITCH))?.slice(NOTIFICATION_SWITCH.length);
  if (!payload || payload.length > 8_000) return;
  try {
    const value = JSON.parse(payload);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120
      || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 1_000
      || typeof value.url !== 'string' || typeof value.replyTo !== 'string') return;
    const reply = new URL(value.replyTo);
    if (reply.protocol !== 'http:' || reply.hostname !== '127.0.0.1' || !reply.port
      || reply.username || reply.password || reply.search || reply.hash || !/^\/[a-f0-9]{64}\/$/.test(reply.pathname)) return;
    const target = new URL(value.url);
    const segments = target.pathname.split('/');
    if (target.protocol !== 'http:' || target.username || target.password || target.search || target.hash
      || segments.length !== 3 || !['sessions', 'bots'].includes(segments[1])
      || !decodeURIComponent(segments[2]).trim() || decodeURIComponent(segments[2]).length > 200) return;
    return { title: value.title.trim(), message: value.message.trim(), url: target.href, replyTo: reply.href };
  } catch { return; }
}

module.exports = { isInternal, isExternal, gatewayUrl, themeSource, notificationFromArgs };
