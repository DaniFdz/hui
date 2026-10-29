import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { fetchJson, fetchWithResponseDeadline, GatewayHttpError, gatewayRequestError, isGatewayUnavailable } from "./request.ts";

/** Answers after `headersMs`; its body then streams for `bodyMs` more. */
function slowGateway(headersMs: number, bodyMs: number) {
  const seen: (AbortSignal | undefined)[] = [];
  const fetcher = (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal ?? undefined;
    seen.push(signal);
    const fail = () => reject(signal!.reason);
    signal?.addEventListener("abort", fail, { once: true });
    setTimeout(() => {
      signal?.removeEventListener("abort", fail);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => controller.error(signal!.reason);
          signal?.addEventListener("abort", abort, { once: true });
          setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            if (signal?.aborted) return;
            controller.enqueue(new TextEncoder().encode('{"ok":true}'));
            controller.close();
          }, bodyMs);
        },
      });
      resolve(new Response(body, { headers: { "content-type": "application/json" } }));
    }, headersMs);
  });
  return { fetcher, seen };
}

test("a slow body is read to the end once the gateway has answered", async () => {
  const { fetcher, seen } = slowGateway(5, 120);
  const response = await fetchWithResponseDeadline(fetcher, "/__hui/sessions/a/open", {}, 40);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(seen[0]?.aborted, false);
});

test("a gateway that does not start answering in time fails with a message worth showing", async () => {
  const { fetcher } = slowGateway(200, 0);
  await assert.rejects(fetchWithResponseDeadline(fetcher, "/__hui/sessions", {}, 30), (error: Error) => {
    assert.equal(error.message, "HUI did not answer within 1 s. Check the connection and try again.");
    assert.equal((error.cause as DOMException).name, "TimeoutError");
    return true;
  });
});

test("a caller's own signal bounds the whole request instead", async () => {
  const { fetcher, seen } = slowGateway(1, 0);
  const own = new AbortController();
  await fetchWithResponseDeadline(fetcher, "/__hui/update/check", { signal: own.signal }, 30);
  assert.equal(seen[0], own.signal);
});

test("a caller's own deadline is not reported as the default one", async () => {
  const { fetcher } = slowGateway(200, 0);
  await assert.rejects(fetchWithResponseDeadline(fetcher, "/__hui/pi/skills/install", { signal: AbortSignal.timeout(10) }), (error: Error) => {
    assert.equal(error.message, "HUI did not answer in time. Check the connection and try again.");
    return true;
  });
});

test("HTTP refusals keep their status and cannot be mistaken for an offline gateway", async () => {
  for (const status of [403, 404, 500, 502, 503, 504]) {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: `refused ${status}` }), { status }));
    await assert.rejects(fetchJson("/__hui/sessions"), (error: unknown) => {
      assert.ok(error instanceof GatewayHttpError);
      assert.equal(error.status, status);
      assert.equal(error.message, `refused ${status}`);
      assert.equal(isGatewayUnavailable(error), status >= 502);
      return true;
    });
  }
});

test("a JSON response that stops delivering bytes fails instead of leaving its chat loading forever", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let body!: ReadableStreamDefaultController<Uint8Array>;
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
        controller.enqueue(new TextEncoder().encode('{"ok":true}'));
        setTimeout(() => controller.enqueue(new Uint8Array()), 30_000);
        signal?.addEventListener("abort", () => controller.error(signal?.reason), { once: true });
      },
    }));
  });
  let outcome: unknown;
  const reading = fetchJson("/__hui/sessions/a/open").then((value) => { outcome = value; }, (error: unknown) => { outcome = error; });
  t.onTestFinished(async () => { body.error(new Error("fixture closed")); await reading; vi.useRealTimers(); });
  await vi.advanceTimersByTimeAsync(40_000);
  assert.ok(outcome instanceof Error, "a stalled body must settle the opening request");
  assert.match(outcome.message, /stopped sending data/u);
  assert.equal(signal?.aborted, true, "the stalled transfer releases its connection");
});

test("a JSON download that keeps making progress can outlast the stall deadline", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  vi.stubGlobal("fetch", async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder();
      controller.enqueue(bytes.encode('{"ok":'));
      setTimeout(() => controller.enqueue(bytes.encode("true")), 30_000);
      setTimeout(() => { controller.enqueue(bytes.encode("}")); controller.close(); }, 60_000);
    },
  })));
  const reading = fetchJson("/__hui/sessions/a/open");
  await vi.advanceTimersByTimeAsync(60_000);
  assert.deepEqual(await reading, { ok: true });
});

test("cancelling a view does not replace the response-header deadline", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal;
      requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
    });
    const view = new AbortController();
    const reading = fetchWithResponseDeadline(fetcher, "/__hui/sessions/a/open", {}, 20_000, view.signal);
    const failed = assert.rejects(reading, /HUI did not answer within 20 s/u);
    await vi.advanceTimersByTimeAsync(20_000);
    await failed;
    assert.equal(view.signal.aborted, false);
    assert.equal(requestSignal?.aborted, true);
  } finally {
    vi.useRealTimers();
  }
});

test("connection failures read as such; deliberate cancellation passes through", () => {
  assert.equal((gatewayRequestError(new TypeError("Failed to fetch")) as Error).message, "Could not reach HUI. Check the connection and try again.");
  assert.equal((gatewayRequestError(new DOMException("x", "TimeoutError"), 20_000) as Error).message, "HUI did not answer within 20 s. Check the connection and try again.");
  const cancelled = new DOMException("cancelled", "AbortError");
  assert.equal(gatewayRequestError(cancelled), cancelled);
});
