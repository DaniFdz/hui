/**
 * Site secrets: a value the operator stores once so an agent can type it into a
 * login form without ever seeing it. They live in their own 0600 file rather
 * than `settings.json`, which is mirrored to workers and echoed by the settings
 * API, and this module only ever hands the value to `manager.ts` for one
 * `Input.insertText` on a frame whose origin matches the secret's.
 *
 * Everything that leaves this module is a view: name, origin and when it was
 * stored. The value is never listed, returned by a route, put in a tool result
 * or written to a log. A stored value is not a boundary once typed — page script
 * on that origin can read the field — so the operator pairs it with an origin
 * allowlist where that matters.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type SiteSecret = { name: string; origin: string; value: string; createdAt: string };
/** What a route, a tool result or a log may carry. */
export type SiteSecretView = { name: string; origin: string; createdAt: string };

export const MAX_SECRET_NAME = 60;
export const MAX_SECRET_VALUE = 8_000;
const MAX_SECRETS = 50;
const NAME = /^[a-z0-9][a-z0-9._-]*$/u;

export class SiteSecretError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** `https://app.example.com` and nothing else: a path, query or fragment scopes nothing. */
export function secretOrigin(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;
  return url.origin;
}

function secretName(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!name || name.length > MAX_SECRET_NAME || !NAME.test(name)) {
    throw new SiteSecretError(`The name must be 1–${MAX_SECRET_NAME} letters, digits, dots, dashes or underscores, starting with a letter or digit.`);
  }
  return name;
}

function stored(value: unknown): SiteSecret[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const list = (value as { secrets?: unknown }).secrets;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const name = typeof record["name"] === "string" ? record["name"] : "";
    const origin = typeof record["origin"] === "string" ? secretOrigin(record["origin"]) : undefined;
    const valueText = typeof record["value"] === "string" ? record["value"] : "";
    if (!name || name.length > MAX_SECRET_NAME || !NAME.test(name) || !origin || !valueText || valueText.length > MAX_SECRET_VALUE) return [];
    return [{ name, origin, value: valueText, createdAt: typeof record["createdAt"] === "string" ? record["createdAt"] : "" }];
  }).slice(0, MAX_SECRETS);
}

export function siteSecretViews(secrets: readonly SiteSecret[]): SiteSecretView[] {
  return secrets.map(({ name, origin, createdAt }) => ({ name, origin, createdAt }));
}

export class SiteSecrets {
  readonly #file: string;

  constructor(options: { file: string }) {
    this.#file = options.file;
  }

  get file(): string {
    return this.#file;
  }

  async list(): Promise<SiteSecretView[]> {
    return siteSecretViews(await this.#read());
  }

  /** The value, for the one call that types it. Never returned to a caller in this app. */
  async find(raw: string): Promise<SiteSecret | undefined> {
    const name = raw.trim().toLowerCase();
    return (await this.#read()).find((secret) => secret.name === name);
  }

  /** Store or replace a value for a name; a replacement keeps the name's origin as given. */
  async save(input: { name: unknown; origin: unknown; value: unknown }): Promise<SiteSecretView[]> {
    const name = secretName(typeof input.name === "string" ? input.name : "");
    const origin = secretOrigin(typeof input.origin === "string" ? input.origin : "");
    if (!origin) throw new SiteSecretError("The origin must be an http or https origin such as https://app.example.com.");
    const value = typeof input.value === "string" ? input.value : "";
    if (!value.trim()) throw new SiteSecretError("The value must be non-empty.");
    if (value.length > MAX_SECRET_VALUE) throw new SiteSecretError(`The value must be at most ${MAX_SECRET_VALUE} characters.`);
    const secrets = await this.#read();
    const existing = secrets.find((secret) => secret.name === name);
    const next: SiteSecret[] = existing
      ? secrets.map((secret) => secret.name === name ? { ...secret, origin, value } : secret)
      : [...secrets, { name, origin, value, createdAt: new Date().toISOString() }].slice(-MAX_SECRETS);
    await this.#write(next);
    return siteSecretViews(next);
  }

  async remove(raw: unknown): Promise<SiteSecretView[]> {
    const name = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    const secrets = await this.#read();
    const next = secrets.filter((secret) => secret.name !== name);
    if (next.length !== secrets.length) await this.#write(next);
    return siteSecretViews(next);
  }

  async #read(): Promise<SiteSecret[]> {
    try {
      return stored(JSON.parse(await readFile(this.#file, "utf8")) as unknown);
    } catch {
      return [];
    }
  }

  /** Private by construction: a directory only the operator can enter, a file only they can read. */
  async #write(secrets: readonly SiteSecret[]): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true, mode: 0o700 });
    const temporary = `${this.#file}.${randomBytes(6).toString("hex")}`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, secrets }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
    await chmod(this.#file, 0o600).catch(() => undefined);
  }
}
