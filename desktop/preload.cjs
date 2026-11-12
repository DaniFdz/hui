/**
 * The window's only way to talk to the shell. The page reports the colour mode this device chose, so the shell can put
 * its title bar, its traffic lights and `prefers-color-scheme` in that mode, and asks once for the appearance
 * `hui doctor --fix` exported from an older settings.json, telling the shell when that seed landed. Nothing else
 * crosses: the page keeps its sandbox, its context isolation and no Node.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('huiDesktop', {
  /** `system`, `light` or `dark`: the mode the Appearance page stores on this device. */
  reportThemeMode: (mode) => ipcRenderer.send('hui:theme-mode', mode),
  /** The exported look, or null when this machine has no seed left to hand over. */
  appearanceSeed: () => ipcRenderer.invoke('hui:appearance-seed'),
  /** The page applied the seed: a later launch must not offer it again. */
  markAppearanceSeedConsumed: () => ipcRenderer.send('hui:appearance-seed-consumed'),
});
