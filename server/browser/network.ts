/**
 * Network capture for the managed browser: the requests a tab made while a
 * conversation asked for them, and a redacted HAR built from them.
 *
 * The log is bounded and small: method, URL, status, type, sizes and timing,
 * with credential-bearing header values replaced by `[redacted]`. Nothing in
 * this module touches the browser; `manager.ts` feeds it CDP events, and the
 * HAR it writes is the one artifact a person may open later, so redaction lives
 * here where it can be tested without a page.
 */

export type NetworkHeader = { name: string; value: string };

export type NetworkEntry = {
  /** What an agent names: `n1`, `n2`… */
  id: string;
  requestId: string;
  url: string;
  method: string;
  /** CDP resource type, such as `Fetch`, `Document` or `XHR`. */
  type: string;
  startedAt: number;
  finishedAt?: number;
  status?: number;
  statusText?: string;
  mimeType?: string;
  /** Response body bytes as the network counted them. */
  bytes?: number;
  failure?: string;
  requestHeaders: NetworkHeader[];
  responseHeaders: NetworkHeader[];
};

export const MAX_NETWORK_ENTRIES = 200;
const MAX_HEADER_VALUE = 500;
const REDACTED = "[redacted]";
/** Values a later reader must not find in the log or the HAR. */
const SECRET_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/iu;
const SECRET_QUERY = /^(?:access_token|api[_-]?key|apikey|auth|code|id_token|key|password|refresh_token|secret|session|token)$/iu;

export function redactedHeaders(headers: Record<string, string> | NetworkHeader[] | undefined): NetworkHeader[] {
  const pairs = Array.isArray(headers)
    ? headers.map((header) => [header.name, header.value] as const)
    : Object.entries(headers ?? {});
  return pairs.map(([name, value]) => ({
    name,
    value: SECRET_HEADER.test(name) ? REDACTED : String(value).slice(0, MAX_HEADER_VALUE),
  }));
}

/** Query values a URL should not carry into a log or a HAR. */
export function redactedUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.slice(0, 2_048);
  }
  for (const key of [...url.searchParams.keys()]) if (SECRET_QUERY.test(key)) url.searchParams.set(key, REDACTED);
  return url.href.slice(0, 2_048);
}

/** What a CDP `Network.requestWillBeSent`/`responseReceived`/`loadingFinished` event describes. */
export type NetworkEvent = {
  requestId: string;
  url?: string;
  method?: string;
  type?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  headers?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  bytes?: number;
  failure?: string;
  at: number;
};

export class NetworkLog {
  #next = 0;
  readonly #entries = new Map<string, NetworkEntry>();
  /** How many requests the log keeps; the oldest go first. */
  readonly limit: number;

  constructor(limit = MAX_NETWORK_ENTRIES) {
    this.limit = limit;
  }

  get recording(): boolean {
    return this.#recording;
  }
  #recording = false;

  start(): void {
    this.#recording = true;
    this.#entries.clear();
  }

  stop(): void {
    this.#recording = false;
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }

  /** A request beginning, a response arriving, or a transfer ending or failing. */
  record(event: NetworkEvent): NetworkEntry | undefined {
    if (event.failure) {
      const entry = this.#entries.get(event.requestId);
      if (entry) {
        entry.failure = event.failure;
        entry.finishedAt = event.at;
      }
      return entry;
    }
    if (event.url !== undefined) {
      const existing = this.#entries.get(event.requestId);
      // A redirect reuses the id; keep one entry per hop, the newest winning.
      const entry: NetworkEntry = existing ?? {
        id: `n${++this.#next}`,
        requestId: event.requestId,
        url: "",
        method: "",
        type: "",
        startedAt: event.at,
        requestHeaders: [],
        responseHeaders: [],
      };
      entry.url = redactedUrl(event.url);
      entry.method = event.method ?? entry.method;
      entry.type = event.type ?? entry.type;
      entry.requestHeaders = redactedHeaders(event.headers);
      if (!existing) this.#entries.set(event.requestId, entry);
      this.#trim();
      return entry;
    }
    const entry = this.#entries.get(event.requestId);
    if (!entry) return undefined;
    if (event.status !== undefined) {
      entry.status = event.status;
      entry.statusText = event.statusText;
      entry.mimeType = event.mimeType;
      entry.responseHeaders = redactedHeaders(event.responseHeaders);
    }
    if (event.bytes !== undefined) entry.bytes = event.bytes;
    if (event.failure === undefined && (event.status !== undefined || event.bytes !== undefined)) entry.finishedAt = event.at;
    return entry;
  }

  entries(): NetworkEntry[] {
    return [...this.#entries.values()].sort((left, right) => left.startedAt - right.startedAt);
  }

  find(id: string): NetworkEntry | undefined {
    return this.entries().find((entry) => entry.id === id);
  }

  #trim(): void {
    if (this.#entries.size <= this.limit) return;
    const oldest = this.entries().slice(0, this.#entries.size - this.limit);
    for (const entry of oldest) this.#entries.delete(entry.requestId);
  }
}

/** A HAR 1.2 document for these entries, with every credential-bearing value redacted. */
export function buildHar(entries: readonly NetworkEntry[], options: { creator: string; version: string; startedAt?: number }): Record<string, unknown> {
  const started = entries.length ? Math.min(...entries.map((entry) => entry.startedAt)) : (options.startedAt ?? Date.now());
  return {
    log: {
      version: "1.2",
      creator: { name: options.creator, version: options.version },
      pages: [{ startedDateTime: new Date(started).toISOString(), id: "page_1", title: "HUI managed browser", pageTimings: {} }],
      entries: entries.map((entry) => {
        const time = Math.max(0, (entry.finishedAt ?? entry.startedAt) - entry.startedAt);
        const query = (() => {
          try {
            return [...new URL(entry.url).searchParams.entries()].map(([name, value]) => ({ name, value }));
          } catch {
            return [];
          }
        })();
        return {
          pageref: "page_1",
          startedDateTime: new Date(entry.startedAt).toISOString(),
          time,
          request: {
            method: entry.method,
            url: entry.url,
            httpVersion: "HTTP/1.1",
            cookies: [],
            headers: entry.requestHeaders,
            queryString: query,
            headersSize: -1,
            bodySize: -1,
          },
          response: {
            status: entry.status ?? 0,
            statusText: entry.statusText ?? (entry.failure ?? ""),
            httpVersion: "",
            cookies: [],
            headers: entry.responseHeaders,
            content: { size: entry.bytes ?? 0, mimeType: entry.mimeType ?? "", text: "" },
            redirectURL: "",
            headersSize: -1,
            bodySize: entry.bytes ?? -1,
          },
          cache: {},
          timings: { send: 0, wait: time, receive: 0 },
          ...(entry.failure ? { _failure: entry.failure } : {}),
        };
      }),
    },
  };
}

/** One request per line, for a model to read. */
export function describeEntry(entry: NetworkEntry): string {
  const status = entry.failure ? `FAILED ${entry.failure}` : `${entry.status ?? "?"} ${entry.statusText ?? ""}`.trim();
  const time = entry.finishedAt ? `${Math.max(0, entry.finishedAt - entry.startedAt)} ms` : "open";
  const bytes = entry.bytes === undefined ? "" : ` · ${entry.bytes} B`;
  return `${entry.id} · ${entry.method} ${status} · ${entry.type || "Other"} · ${time}${bytes}\n  ${entry.url}`;
}
