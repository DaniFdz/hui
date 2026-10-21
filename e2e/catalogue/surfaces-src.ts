/**
 * Collects the browser's user-facing surfaces as `kind:key` strings for the use-case catalogue: routed pages,
 * Settings pages, navigation kinds, Work views, HUI's slash commands, Work pane shortcuts, session menu mnemonics,
 * transcript row and item kinds and settings keys. The gateway's surfaces are in `surfaces-server.ts`, because no
 * file may import both `src/` and `server/` (rule R12 in docs/map.md).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HUI_PAGES } from "../../src/lib/pages.ts";
import { ROUTABLE_SETTINGS_PAGES } from "../../src/lib/navigation.ts";
import { HUI_COMMANDS, HUI_SESSION_COMMANDS } from "../../src/lib/composer/slash-commands.ts";
import { WORK_SHORTCUTS } from "../../src/lib/work-shortcuts.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settings/settings.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFile(join(root, path), "utf8");

function typeKinds(source: string, typeName: string): string[] {
  const start = source.indexOf(`export type ${typeName} =`);
  if (start < 0) throw new Error(`${typeName} not found`);
  const body = source.slice(start, source.indexOf(";\n", start));
  return [...body.matchAll(/kind: "([A-Za-z]+)"/gu)].map((match) => match[1]!);
}

function leaves(value: unknown, path: string): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
  }
  return [path];
}

export async function browserSurfaces(): Promise<string[]> {
  const navigation = await read("src/lib/navigation.ts");
  const projection = await read("src/views/chat/projection.ts");
  const menu = await read("src/lib/session/menu-shortcuts.ts");
  const workPane = await read("src/lib/work-pane.ts");
  const transcript = await read("src/api/sessions.ts");
  const mnemonics = [...(/const ACTIONS[^=]*= \{([^}]*)\}/u.exec(menu)?.[1] ?? "").matchAll(/: "([a-z]+)"/gu)].map((match) => match[1]!);
  return [
    ...HUI_PAGES.map((page) => `page:${page.id}`),
    ...ROUTABLE_SETTINGS_PAGES.map((page) => `settings-page:${page}`),
    ...typeKinds(navigation, "NavigationTarget").map((kind) => `nav:${kind}`),
    ...typeKinds(workPane, "WorkViewRef").map((kind) => `work-view:${kind}`),
    ...[...HUI_COMMANDS, ...HUI_SESSION_COMMANDS].map((command) => `command:${command.name}`),
    ...Object.keys(WORK_SHORTCUTS).map((name) => `shortcut:${name}`),
    ...mnemonics.map((action) => `shortcut:session-menu.${action}`),
    ...typeKinds(projection, "ChatProjectionRow").map((kind) => `row:${kind}`),
    ...typeKinds(transcript, "TranscriptItem").map((kind) => `item:${kind}`),
    ...leaves(DEFAULT_SETTINGS, "").map((key) => `setting:${key}`),
  ];
}
