/** Installs the completion programs of `cli/completions/` into an installation prefix's share directories: the npm
 * package's postinstall does it on a global install and the Nix package for its own prefix, so `hui` completes without
 * an rc line. It never fails an install; a prefix it cannot write only reports the line to add by hand. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCES = { bash: 'hui.bash', zsh: '_hui' };

/** Where each shell's program goes, relative to an installation prefix: bash-completion finds its own on demand. */
export const COMPLETION_FILES = { bash: 'share/bash-completion/completions/hui', zsh: 'share/zsh/site-functions/_hui' };

/** The prefix that owns a package directory, or undefined when it is not an installed `<prefix>/lib/node_modules/hui`. */
export function completionPrefix(packageRoot = dirname(here)) {
  const root = resolve(packageRoot);
  return /(?:^|[/\\])node_modules[/\\]hui$/u.test(root) ? resolve(root, '../../..') : undefined;
}

/** Writes both programs under `prefix` and returns their paths. */
export async function installCompletions(prefix) {
  const written = [];
  for (const [shell, relative] of Object.entries(COMPLETION_FILES)) {
    const file = join(prefix, relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, await readFile(join(here, 'completions', SOURCES[shell]), 'utf8'));
    written.push(file);
  }
  return written;
}

/** The prefix to install into: an argument, or the one a global npm install runs from. */
export function prefixToInstall(argv = process.argv.slice(2), env = process.env) {
  if (argv[0]) return argv[0];
  return env.npm_config_global === 'true' && env.HUI_SKIP_COMPLETIONS !== '1' ? completionPrefix() : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prefix = prefixToInstall();
  if (prefix) {
    try {
      const written = await installCompletions(prefix);
      console.log(`hui: shell completion in ${dirname(dirname(dirname(written[0])))} (zsh needs share/zsh/site-functions in fpath).`);
    } catch (error) {
      console.log(`hui: shell completion was not installed (${error.message}); add eval "$(hui completion bash)" to your shell, or the zsh fpath line, by hand.`);
    }
  }
}
