/**
 * Appearance the gateway's `settings.json` still carries. A theme, colour mode, accent, typeface, text size and the
 * conversation preferences in `chat` belong to the device that shows them now (`src/lib/appearance/store.ts`), and
 * the gateway neither reads nor keeps them. A file an older HUI wrote still holds them, so the check reports them.
 *
 * `--fix` rewrites the file without them and, for the look alone, writes `desktop-appearance.json` beside it
 * (`desktop-appearance-seed.ts`): HUI's desktop app applies that seed to a device that stored no appearance of its own,
 * so the look someone already had is not lost. Nothing is written when the look is only HUI's defaults.
 */
import { readFile, writeFile } from "node:fs/promises";
import { HUI_SETTINGS_FILE, readHuiSettings, writeHuiSettings } from "../server/hui-settings.ts";
import { DESKTOP_APPEARANCE_FILE, desktopAppearanceSeed, lookFromSettings, lookIsDefault } from "./desktop-appearance-seed.ts";
import type { DoctorCheck, DoctorItem, DoctorResult } from "./doctor-types.ts";

const ID = "appearance";
const TITLE = "Appearance";

/** The keys that moved to the device, and the chat block's own share of them. */
const MOVED = ["theme", "themeMode", "accent", "fontUi", "fontChat", "fontTerminal", "textScale"] as const;
const MOVED_CHAT = ["messageWidth", "collapseTaskProgress", "sendShortcut", "githubEmbeds", "datadogEmbeds"] as const;

const NOTES = [
  "Appearance is per device since 2026-11-16: a theme, colour mode, accent, typeface, text size and chat preference are kept by the browser, app or phone that shows them, and every device starts from HUI's defaults.",
  "The look alone (theme, colour mode, accent, typefaces, terminal font and text size) is exported for HUI's desktop app, which applies it to a device that stored none of its own. The chat preferences are not exported: they are habits, not how a screen looks.",
];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Carried = { id: string; value: unknown };

/** The moving keys the file still names, read raw: `normalizeSettings` has already dropped them by the time a caller
 * sees a `Settings`. */
export function carriedAppearance(raw: unknown): Carried[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const source = raw as Record<string, unknown>;
  const carried: Carried[] = MOVED.filter((key) => key in source).map((key) => ({ id: key, value: source[key] }));
  const chat = source["chat"];
  if (chat && typeof chat === "object" && !Array.isArray(chat)) {
    for (const key of MOVED_CHAT) if (key in chat) carried.push({ id: `chat.${key}`, value: (chat as Record<string, unknown>)[key] });
  }
  return carried;
}

const describe = ({ value }: Carried) => JSON.stringify(value) ?? String(value);
const movedDetail = (entry: Carried) => `${describe(entry)} — every device keeps its own now`;
const count = (items: number) => `${items} ${items === 1 ? "setting" : "settings"}`;

function result(carried: readonly Carried[], unreadable?: string): DoctorResult {
  const items: DoctorItem[] = carried.map((entry): DoctorItem => ({ id: entry.id, label: entry.id, status: "issue", detail: movedDetail(entry) }));
  return {
    id: ID,
    title: TITLE,
    status: items.length || unreadable ? "issue" : "ok",
    summary: unreadable ? `${HUI_SETTINGS_FILE} can't be read`
      : !items.length ? "no appearance is stored on the gateway"
        : `${count(items.length)} in settings.json ${items.length === 1 ? "belongs" : "belong"} to each device now`,
    items,
    notes: items.length ? [...NOTES] : [],
  };
}

async function readRaw(): Promise<{ raw?: unknown; carried: Carried[]; unreadable?: string }> {
  try {
    const raw: unknown = JSON.parse(await readFile(HUI_SETTINGS_FILE, "utf8"));
    return { raw, carried: carriedAppearance(raw) };
  } catch (error) {
    // A missing file is a fresh install, not something to report.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { carried: [] };
    return { carried: [], unreadable: message(error) };
  }
}

async function inspect(): Promise<DoctorResult> {
  const { carried, unreadable } = await readRaw();
  return result(carried, unreadable);
}

/** Writes the seed the desktop app reads, or nothing when the file only names what a fresh device shows anyway. */
async function exportLook(raw: unknown): Promise<{ exported: boolean; note: string }> {
  const look = lookFromSettings(raw);
  if (lookIsDefault(look)) {
    return { exported: false, note: `nothing to export for the desktop app: that look is already HUI's default, so no ${DESKTOP_APPEARANCE_FILE} was written` };
  }
  const seed = desktopAppearanceSeed(look, { gatewayName: typeof (raw as Record<string, unknown>)?.["name"] === "string" ? String((raw as Record<string, unknown>)["name"]) : "" });
  await writeFile(DESKTOP_APPEARANCE_FILE, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  return { exported: true, note: `exported the look to ${DESKTOP_APPEARANCE_FILE} for HUI's desktop app (gateway "${seed.gateway}"), which applies it to a device that stored none of its own` };
}

export const appearanceCheck: DoctorCheck = {
  id: ID,
  title: TITLE,
  inspect,
  async fix() {
    const { raw, carried, unreadable } = await readRaw();
    // The file did not parse, so nothing proves what is in it: leave it for the operator rather than write defaults.
    if (!carried.length) return result([], unreadable);
    let exportNote: string;
    let exported: boolean;
    try {
      ({ exported, note: exportNote } = await exportLook(raw));
    } catch (error) {
      return { ...result(carried, unreadable), items: carried.map((entry): DoctorItem => ({ id: entry.id, label: entry.id, status: "failed", detail: message(error) })), notes: [...NOTES] };
    }
    try {
      // The gateway's own reader drops the moved keys, so what it reads back is the file without them and with every
      // setting the gateway still owns.
      await writeHuiSettings(await readHuiSettings());
    } catch (error) {
      return { ...result(carried, unreadable), summary: `${HUI_SETTINGS_FILE} could not be rewritten`, items: carried.map((entry): DoctorItem => ({ id: entry.id, label: entry.id, status: "failed", detail: message(error) })), notes: [exportNote, ...NOTES] };
    }
    const after = await inspect();
    const kept = exported ? exportNote : "no look was exported: every value was already HUI's default";
    return {
      ...after,
      status: after.status === "ok" ? "fixed" : after.status,
      summary: after.status === "ok" ? `removed ${count(carried.length)} that ${carried.length === 1 ? "belongs" : "belong"} to each device now; ${kept}` : after.summary,
      items: carried.map((entry): DoctorItem => ({ id: entry.id, label: entry.id, status: "fixed", detail: movedDetail(entry) })),
      notes: [...NOTES],
    };
  },
};
