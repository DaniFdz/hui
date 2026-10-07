/** `hui desktop`: opens the desktop window detached from the terminal. On macOS a registered HUI.app is preferred;
 * otherwise Electron is started directly on the window shell with the installation's launch configuration. */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_MARKER, launchConfig } from './install.mjs';

/** Starts a process that outlives this CLI, resolving once it has spawned. */
function detached(spawnImpl, command, args, options = {}) {
  const child = spawnImpl(command, args, { ...options, detached: true, stdio: 'ignore' });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

async function ownedBundle(bundle) {
  const owner = await readFile(join(bundle, 'Contents/Resources/hui-owner'), 'utf8').catch(() => '');
  return owner === OWNER_MARKER;
}

/** Opens the desktop app and returns the terminal. On macOS the registered
 * HUI.app is preferred so the Dock shows HUI's own name and icon. */
export async function launchDesktop(installationRoot, {
  platform = process.platform,
  applications = join(homedir(), 'Applications'),
  spawnImpl = spawn,
  electron = () => createRequire(import.meta.url)('electron'),
  log = console.log,
} = {}) {
  const bundle = join(applications, 'HUI.app');
  if (platform === 'darwin' && await ownedBundle(bundle)) {
    await detached(spawnImpl, '/usr/bin/open', [bundle]);
    return 'app';
  }
  const env = { ...process.env, HUI_DESKTOP_LAUNCH: JSON.stringify(launchConfig(installationRoot)) };
  delete env.ELECTRON_RUN_AS_NODE;
  await detached(spawnImpl, electron(), [fileURLToPath(new URL('./main.cjs', import.meta.url))], { env });
  if (platform === 'darwin') log('hui: tip: run `hui install-app` to add HUI to Spotlight, Finder and the Dock.');
  return 'electron';
}
