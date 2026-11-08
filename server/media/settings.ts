/**
 * HUI's media-generation settings: which provider serves each kind, its model, and the API keys of providers that
 * need one. The file holds credentials, so it is written 0600 and atomically, and the snapshot handed to the
 * browser reports only whether a key is configured.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { CONFIG_DIR } from "../paths.ts";
import type { MediaKind } from "./provider.ts";

export const MEDIA_SETTINGS_FILE = join(CONFIG_DIR, "media.json");

/** Providers HUI can serve media from, in the order a new installation tries them. */
export const MEDIA_PROVIDERS = ["openai-codex", "gemini-web", "gemini"] as const;
export type MediaProviderId = (typeof MEDIA_PROVIDERS)[number];

export type MediaSettings = {
  preferred: Partial<Record<MediaKind, MediaProviderId>>;
  models: Partial<Record<MediaProviderId, string>>;
  gemini: { apiKey?: string };
};

/** What the browser may see: no credential, only whether one exists. */
export type MediaSettingsView = {
  preferred: Partial<Record<MediaKind, MediaProviderId>>;
  models: Partial<Record<MediaProviderId, string>>;
  gemini: { configured: boolean };
};

export class MediaSettingsError extends Error {}

export function defaultMediaSettings(): MediaSettings {
  return { preferred: {}, models: {}, gemini: {} };
}

function providerId(value: unknown): MediaProviderId | undefined {
  return MEDIA_PROVIDERS.find((id) => id === value);
}

/** A stored value reads as the defaults when it is malformed, never as an error: a broken file must not stop HUI. */
export function normalizeMediaSettings(raw: unknown): MediaSettings {
  const settings = defaultMediaSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return settings;
  const record = raw as Record<string, unknown>;
  const preferred = record["preferred"];
  if (preferred && typeof preferred === "object" && !Array.isArray(preferred)) {
    const image = providerId((preferred as Record<string, unknown>)["image"]);
    if (image) settings.preferred.image = image;
  }
  const models = record["models"];
  if (models && typeof models === "object" && !Array.isArray(models)) {
    for (const id of MEDIA_PROVIDERS) {
      const model = (models as Record<string, unknown>)[id];
      if (typeof model === "string" && model.length > 0 && model.length <= 120) settings.models[id] = model;
    }
  }
  const gemini = record["gemini"];
  if (gemini && typeof gemini === "object" && !Array.isArray(gemini)) {
    const key = (gemini as Record<string, unknown>)["apiKey"];
    if (typeof key === "string" && key.trim().length > 0 && key.length <= 500) settings.gemini.apiKey = key.trim();
  }
  return settings;
}

export function viewMediaSettings(settings: MediaSettings): MediaSettingsView {
  return { preferred: settings.preferred, models: settings.models, gemini: { configured: Boolean(settings.gemini.apiKey) } };
}

export async function readMediaSettings(path = MEDIA_SETTINGS_FILE): Promise<MediaSettings> {
  try {
    return normalizeMediaSettings(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return defaultMediaSettings();
  }
}

/** A write keeps a key the caller did not mention, so saving a model never erases a credential. */
export function mergeMediaSettings(current: MediaSettings, update: unknown): MediaSettings {
  if (!update || typeof update !== "object" || Array.isArray(update)) throw new MediaSettingsError("Media settings must be an object.");
  const next = normalizeMediaSettings(current);
  const record = update as Record<string, unknown>;
  if (Object.hasOwn(record, "preferred")) {
    const preferred = record["preferred"];
    if (!preferred || typeof preferred !== "object" || Array.isArray(preferred)) throw new MediaSettingsError("preferred must be an object.");
    const image = (preferred as Record<string, unknown>)["image"];
    if (image === undefined || image === null) delete next.preferred.image;
    else {
      const id = providerId(image);
      if (!id) throw new MediaSettingsError("Unknown media provider.");
      next.preferred.image = id;
    }
  }
  if (Object.hasOwn(record, "models")) {
    const models = record["models"];
    if (!models || typeof models !== "object" || Array.isArray(models)) throw new MediaSettingsError("models must be an object.");
    for (const [id, value] of Object.entries(models as Record<string, unknown>)) {
      const provider = providerId(id);
      if (!provider) throw new MediaSettingsError("Unknown media provider.");
      if (value === null) delete next.models[provider];
      else if (typeof value === "string" && value.trim()) next.models[provider] = value.trim().slice(0, 120);
      else throw new MediaSettingsError("A model id must be a non-empty string.");
    }
  }
  if (Object.hasOwn(record, "gemini")) {
    const gemini = record["gemini"];
    if (!gemini || typeof gemini !== "object" || Array.isArray(gemini)) throw new MediaSettingsError("gemini must be an object.");
    const key = (gemini as Record<string, unknown>)["apiKey"];
    if (key === null || key === "") delete next.gemini.apiKey;
    else if (typeof key === "string" && key.trim()) next.gemini.apiKey = key.trim().slice(0, 500);
    else throw new MediaSettingsError("An API key must be a non-empty string.");
  }
  return next;
}

export async function writeMediaSettings(settings: MediaSettings, path = MEDIA_SETTINGS_FILE): Promise<MediaSettings> {
  const normalized = normalizeMediaSettings(settings);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `media.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return normalized;
}
