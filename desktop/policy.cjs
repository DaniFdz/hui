/** Pure decisions for the desktop shell, kept apart from the Electron process code: which URLs stay in the window,
 * which open externally, the address a gateway is served at and how one is recognised, `hui://` chat links, validated
 * notification destinations and the saved color scheme. */
const { URL } = require('node:url');
const { BlockList, isIP } = require('node:net');

/** The networks a gateway is reached on from this device: loopback, private, carrier-grade NAT (Tailscale's own range)
 * and unique-local IPv6. A link-local address is deliberately absent — nothing administers a gateway there, and a
 * metadata endpoint lives on one. */
const LOCAL_NETWORKS = new BlockList();
for (const [network, prefix, family] of [
  ['127.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.168.0.0', 16, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'], ['::1', 128, 'ipv6'], ['fc00::', 7, 'ipv6'],
]) LOCAL_NETWORKS.addSubnet(network, prefix, family);

/** The http(s) URL a value names, or nothing: the scheme every gateway page and every web link uses. */
function httpUrl(value) {
  try {
    const target = new URL(value);
    return ['http:', 'https:'].includes(target.protocol) ? target : undefined;
  } catch { return; }
}

/** The address a gateway is reached at: its origin and any path it is served under, without a trailing slash. */
function gatewayBase(value) {
  const target = httpUrl(value);
  if (!target || target.username || target.password) return;
  return `${target.origin}${target.pathname.replace(/\/+$/u, '')}`;
}

/** Whether `target` is a page of the gateway at `base`: that gateway's origin, under the path it is served at. */
function isGatewayPage(target, base) {
  const url = httpUrl(target);
  const gateway = base && gatewayBase(base);
  if (!url || !gateway) return false;
  const root = new URL(gateway);
  if (url.origin !== root.origin) return false;
  const prefix = root.pathname.replace(/\/+$/u, '');
  return !prefix || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
}

/** Whether an address names a machine on this device's own network, so it could be this device's other gateway and
 * one identity request is worth it. A public site is the browser's, and is never asked. */
function mayBeGateway(value) {
  const target = httpUrl(value);
  if (!target) return false;
  const host = target.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const family = isIP(host) === 4 ? 'ipv4' : isIP(host) === 6 ? 'ipv6' : undefined;
  if (family) return LOCAL_NETWORKS.check(host, family);
  // A machine name, with or without the dot that makes it a fully qualified one.
  const name = host.replace(/\.$/u, '');
  if (!name.includes('.')) return true;
  return /(?:^|\.)(?:local|localhost|internal|lan|home\.arpa|ts\.net)$/u.test(name);
}

/** The addresses to try as the base of the gateway `target` belongs to, nearest first: the origin, then its path one
 * segment longer each time, so a gateway served under a path is found too. */
function gatewayCandidates(value, limit = 4) {
  const target = httpUrl(value);
  if (!target) return [];
  const bases = [target.origin];
  const segments = target.pathname.split('/').filter(Boolean);
  for (let length = 1; length <= segments.length && bases.length < limit; length++) {
    bases.push(`${target.origin}/${segments.slice(0, length).join('/')}`);
  }
  return bases;
}

/** Whether a body is the identity handshake `GET /__hui/update` answers: HUI's own snapshot, not another app's page. */
function isGatewayHandshake(body) {
  return Boolean(body) && typeof body === 'object' && !Array.isArray(body)
    && 'currentVersion' in body && 'job' in body
    && (body.currentVersion === null || typeof body.currentVersion === 'string');
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

function chatUrl(value) {
  try {
    const target = new URL(value);
    const segments = target.pathname.split('/');
    if (target.protocol !== 'http:' || target.username || target.password || target.search || target.hash
      || segments.length !== 3 || !['sessions', 'bots'].includes(segments[1])
      || !decodeURIComponent(segments[2]).trim() || decodeURIComponent(segments[2]).length > 200) return;
    return target.href;
  } catch { return; }
}

/** A `hui://sessions/<id>` or `hui://bots/<id>` link, as `?open=app` hands off and as a launcher opens one: the
 * gateway path it shows, or nothing when it is not such a link. */
function appChatPath(link) {
  try {
    const target = new URL(link);
    if (target.protocol !== 'hui:' || target.username || target.password || target.search || target.hash) return;
    const [kind, id, ...rest] = [target.hostname, ...target.pathname.split('/').filter(Boolean)];
    if (!['sessions', 'bots'].includes(kind) || !id || rest.length) return;
    const decoded = decodeURIComponent(id);
    if (!decoded.trim() || decoded.length > 200 || decoded.includes('/')) return;
    return `/${kind}/${encodeURIComponent(decoded)}`;
  } catch { return; }
}

function notificationFromUrl(link) {
  try {
    const { protocol, pathname } = new URL(link);
    const payload = protocol === 'hui-notification:' ? decodeURIComponent(pathname) : '';
    if (!payload || payload.length > 8_000) return;
    const value = JSON.parse(payload);
    const optional = (text, limit) => text === undefined || (typeof text === 'string' && text.length <= limit);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120
      || !optional(value.subtitle, 120) || !optional(value.message, 1_000)
      || !['low', 'normal', 'high', undefined].includes(value.priority)
      || typeof value.url !== 'string' || typeof value.replyTo !== 'string') return;
    const reply = new URL(value.replyTo);
    if (reply.protocol !== 'http:' || reply.hostname !== '127.0.0.1' || !reply.port
      || reply.username || reply.password || reply.search || reply.hash || !/^\/[a-f0-9]{64}\/$/.test(reply.pathname)) return;
    const target = chatUrl(value.url);
    if (!target) return;
    return {
      title: value.title.trim(), subtitle: value.subtitle?.trim() ?? '', message: value.message?.trim() ?? '',
      priority: value.priority ?? 'normal', url: target, replyTo: reply.href,
    };
  } catch { return; }
}

module.exports = {
  isExternal, gatewayUrl, themeSource, chatUrl, appChatPath, notificationFromUrl,
  gatewayBase, isGatewayPage, mayBeGateway, gatewayCandidates, isGatewayHandshake,
};
