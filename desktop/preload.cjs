/**
 * The window's only way to talk to the shell. The page reports the colour mode this device chose, so the shell can put
 * its title bar, its traffic lights and `prefers-color-scheme` in that mode; it reports the gateways this device lists,
 * and asks the shell to switch to one, so a switch stays in the window; it asks once for the appearance `hui doctor
 * --fix` exported from an older settings.json and says when that seed landed. Nothing else crosses: the page keeps its
 * sandbox, its context isolation and no Node.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** Bounds what the page can send in one report: this device's own list is far shorter. */
const MAX_GATEWAYS = 32;

contextBridge.exposeInMainWorld('huiDesktop', {
  /** `system`, `light` or `dark`: the mode the Appearance page stores on this device. */
  reportThemeMode: (mode) => ipcRenderer.send('hui:theme-mode', mode),
  /** The gateways this device lists, as http(s) addresses: the shell shows a page of one of them in this window. */
  reportGateways: (links) => ipcRenderer.send('hui:gateways', Array.isArray(links) ? links.slice(0, MAX_GATEWAYS) : []),
  /** Asks the window to show a gateway, and hears back whether it will: a browser navigates its own tab instead. */
  openGateway: (url) => ipcRenderer.invoke('hui:open-gateway', url),
  /** The exported look, or null when this machine has no seed left to hand over. */
  appearanceSeed: () => ipcRenderer.invoke('hui:appearance-seed'),
  /** The page applied the seed: a later launch must not offer it again. */
  markAppearanceSeedConsumed: () => ipcRenderer.send('hui:appearance-seed-consumed'),
});
