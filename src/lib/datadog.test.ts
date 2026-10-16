import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { parseDatadogUrl, type DatadogConnection, type DatadogPreviewResult } from "../../shared/datadog.ts";
import {
  clearDatadogPreviewCache,
  DATADOG_CHANGED,
  datadogPreviewMessage,
  formatDatadogRange,
  loadDatadogPreviews,
  signInToDatadog,
} from "./datadog.ts";

const ref = (url: string) => parseDatadogUrl(url)!;
const PROD = { name: "prod", site: "app.datadoghq.com" };

test("batches one request per message, reuses results and retries failures after a sign-in", async () => {
  clearDatadogPreviewCache();
  const requests: string[] = [];
  let error: DatadogPreviewResult["error"] = "signed_out";
  const fetcher = async <T>(url: string): Promise<T> => {
    requests.push(url);
    const urls = new URL(url, "http://hui").searchParams.getAll("url");
    return { previews: urls.map((item): DatadogPreviewResult => error ? { url: item, error, signIn: PROD } : { url: item, preview: { kind: "share", url: item, title: "t" } }) } as T;
  };
  const refs = ["a", "b", "c", "d"].map((id) => ref(`https://app.datadoghq.com/s/org/${id}`));
  assert.equal((await loadDatadogPreviews(refs, 0, fetcher)).length, 3, "at most three cards");
  assert.equal(requests.length, 1);
  await loadDatadogPreviews(refs, 1_000, fetcher);
  assert.equal(requests.length, 1, "fresh results are not refetched");

  // A sign-in elsewhere on the page drops remembered failures and tells cards to load again.
  const page = new EventTarget();
  vi.stubGlobal("window", page);
  const reloaded = new Promise((resolve) => page.addEventListener(DATADOG_CHANGED, resolve, { once: true }));
  const connection = (login: DatadogConnection["login"]): DatadogConnection => ({ cli: { installed: true, version: "1" }, orgs: [{ ...PROD, status: "connected" }], pupOrgs: [], login });
  const answers = [connection({ phase: "pending", org: PROD, expiresAt: 1 }), connection({ phase: "pending", org: PROD, expiresAt: 1 }), connection({ phase: "idle" })];
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return Response.json(answers.shift());
  });
  await signInToDatadog(PROD, async () => {});
  assert.deepEqual(calls, ["POST /__hui/datadog/login", "GET /__hui/datadog", "GET /__hui/datadog"]);
  await reloaded;
  error = undefined;
  assert.equal((await loadDatadogPreviews(refs, 2_000, fetcher))[0]?.preview?.title, "t");
  assert.equal(requests.length, 2);
});

test("a sign-in counts only when its own org ends up connected", async () => {
  const view = (login: DatadogConnection["login"], status: "connected" | "signed_out" = "signed_out"): DatadogConnection => ({ cli: { installed: true, version: "1" }, orgs: [{ ...PROD, status }], pupOrgs: [], login });
  vi.stubGlobal("fetch", async () => Response.json(view({ phase: "failed", org: PROD, message: "Error: OAuth error: access_denied" })));
  await assert.rejects(signInToDatadog(PROD, async () => {}), /access_denied/u);

  // Cancelled from Settings: the gateway goes back to idle, but the org is still signed out.
  const cancelled = [view({ phase: "pending", org: PROD, expiresAt: 1 }), view({ phase: "idle" })];
  vi.stubGlobal("fetch", async () => Response.json(cancelled.shift()));
  await assert.rejects(signInToDatadog(PROD, async () => {}), /did not finish/u);

  // Already signing in to this org elsewhere (409): the card waits on that sign-in, through a dropped poll.
  const page = new EventTarget();
  vi.stubGlobal("window", page);
  const answers: (() => Response)[] = [
    () => Response.json({ error: "Another Datadog sign-in is in progress." }, { status: 409 }),
    () => Response.json(view({ phase: "pending", org: PROD, expiresAt: 1 })),
    () => { throw new TypeError("network down"); },
    () => Response.json(view({ phase: "idle" }, "connected")),
  ];
  vi.stubGlobal("fetch", async () => answers.shift()!());
  const reloaded = new Promise((resolve) => page.addEventListener(DATADOG_CHANGED, resolve, { once: true }));
  await signInToDatadog(PROD, async () => {});
  assert.equal(answers.length, 0);
  await reloaded;
});

test("a failed request becomes unavailable, and a full page cache keeps the links being loaded", async () => {
  clearDatadogPreviewCache();
  const results = await loadDatadogPreviews([ref("https://app.datadoghq.com/s/a/b")], 0, async () => { throw new Error("offline"); });
  assert.deepEqual(results, [{ url: "https://app.datadoghq.com/s/a/b", error: "unavailable" }]);

  clearDatadogPreviewCache();
  const titled = async <T>(url: string): Promise<T> => ({
    previews: new URL(url, "http://hui").searchParams.getAll("url").map((item): DatadogPreviewResult => ({ url: item, preview: { kind: "share", url: item, title: item.slice(-1) } })),
  }) as T;
  for (let index = 0; index < 59; index += 1) await loadDatadogPreviews([ref(`https://app.datadoghq.com/s/fill/x${index}`)], 0, titled);
  const message = await loadDatadogPreviews(["a", "b", "c"].map((id) => ref(`https://app.datadoghq.com/s/new/${id}`)), 0, titled);
  assert.deepEqual(message.map((result) => result.preview?.title), ["a", "b", "c"]);
});

test("says why a card has no graph and when its graph is from", () => {
  const share = ref("https://app.datadoghq.com/s/a/b");
  const widget = ref("https://acme.datadoghq.com/dashboard/abc-123-xyz?tile_focus=1");
  assert.equal(datadogPreviewMessage(share, { url: share.url, error: "not_found" }), "This share link is not available.");
  assert.equal(datadogPreviewMessage(widget, { url: widget.url, error: "not_found" }), "Not found in your Datadog orgs for acme.datadoghq.com.");
  assert.equal(datadogPreviewMessage(widget, { url: widget.url, error: "no_org" }), "Add a Datadog org for acme.datadoghq.com in Settings → Integrations to preview it.");
  assert.equal(datadogPreviewMessage(widget, { url: widget.url, error: "signed_out", signIn: { name: "", site: "dd.datad0g.com" } }), "Sign in to pup's default session for dd.datad0g.com to preview it.");
  assert.equal(datadogPreviewMessage(widget, { url: widget.url, preview: { kind: "widget", url: widget.url, title: "t" } }), "Datadog could not draw this widget.");
  assert.equal(datadogPreviewMessage(widget, { url: widget.url, preview: { kind: "widget", url: widget.url, title: "t", image: "data:image/png;base64,x" } }), "");
  assert.equal(formatDatadogRange(0, 1, true), "Past 1 hour");
  // Local time in the reader's own format; the date appears once for a range within one day.
  const from = new Date(2026, 9, 16, 10, 20).getTime();
  const day = (time: number) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(time);
  const sameDay = formatDatadogRange(from, from + 3_600_000);
  assert.equal(sameDay.split(day(from)).length - 1, 1, sameDay);
  assert.match(sameDay, /10:20.*–.*11:20/u);
  assert.match(formatDatadogRange(from, from + 86_400_000), new RegExp(`^${day(from)}, .+ – ${day(from + 86_400_000)}, `, "u"));
});
