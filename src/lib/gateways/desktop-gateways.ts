/**
 * Telling HUI's desktop shell which gateways this device lists, so switching to one — or following a link to one —
 * loads it in the app's window instead of the system browser. The shell also recognises a gateway on this device's own
 * network by its identity handshake; this report is what makes a saved gateway on a public name work, and a saved one
 * that is down today still open in the window rather than in the browser. A browser has no shell, and nothing happens
 * there. The list is presentation only and carries no transcript, credential or setting.
 */

/** What the desktop preload exposes. A browser has no shell, and nothing happens there. */
export type GatewayListBridge = {
  reportGateways?(links: readonly string[]): void;
  /** Answers whether the window will show `url`; a browser, or a shell that cannot, leaves the page to navigate. */
  openGateway?(url: string): Promise<unknown>;
};

/** Bounds what the page teaches the shell: this device's own list is far shorter. */
export const MAX_REPORTED_GATEWAYS = 32;

function bridge(): GatewayListBridge | undefined {
  return (globalThis as { huiDesktop?: GatewayListBridge }).huiDesktop;
}

/**
 * The addresses the shell may show, as a gateway is reached at: an http(s) origin and any path it is served under,
 * without a trailing slash. Anything else is dropped, duplicates collapse, and the order the caller used is kept.
 */
export function reportedGateways(links: readonly string[]): string[] {
  const kept: string[] = [];
  for (const link of links) {
    const address = gatewayAddress(link);
    if (address && !kept.includes(address)) kept.push(address);
    if (kept.length === MAX_REPORTED_GATEWAYS) break;
  }
  return kept;
}

function gatewayAddress(link: string): string | undefined {
  try {
    const target = new URL(link.trim());
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return undefined;
    if (target.search || target.hash) return undefined;
    return `${target.origin}${target.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return undefined;
  }
}

/** Tells the shell, once per change. A missing bridge, or one that throws, leaves the page as it was. */
export function reportGatewaysToShell(links: readonly string[], shell: GatewayListBridge | undefined = bridge()): void {
  const gateways = reportedGateways(links);
  if (!gateways.length) return;
  try {
    shell?.reportGateways?.(gateways);
  } catch {
    // The shell failing to hear this is not the page's problem.
  }
}

/**
 * Switches this page to `url`. HUI's desktop app shows it in its own window when the shell says it will, and answers
 * before this page moves, so a switch is a deliberate request rather than a link the shell has to recognise again; a
 * browser, or a shell that cannot open it, navigates this page.
 */
export function switchGateway(
  url: string,
  navigate: (url: string) => void = (target) => window.location.assign(target),
  shell: GatewayListBridge | undefined = bridge(),
): void {
  const open = shell?.openGateway;
  if (!open) {
    navigate(url);
    return;
  }
  let opening: Promise<unknown>;
  try {
    opening = Promise.resolve(open.call(shell, url));
  } catch {
    navigate(url);
    return;
  }
  void opening.then((shown) => { if (shown !== true) navigate(url); }, () => navigate(url));
}
