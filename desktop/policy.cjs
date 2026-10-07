/** Pure decisions for the desktop shell, kept apart from the Electron process code: which URLs stay in the window,
 * which open externally, what counts as a valid gateway address, and how the saved theme maps to Electron's. */
const { URL } = require('node:url');
const { isIP } = require('node:net');

function isInternal(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

function isExternal(url) {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(url).protocol); }
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

module.exports = { isInternal, isExternal, gatewayUrl, themeSource };
