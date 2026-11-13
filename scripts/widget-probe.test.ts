/** Executes the shipped isolation probe so opaque empty cookie reads pass, but exposed data and working APIs fail. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "vitest";

const html = await readFile(new URL("../e2e/fixtures/widget-probe.html", import.meta.url), "utf8");
// Extract the trusted checked-in fixture, not arbitrary HTML for sanitization.
const scriptPattern = /<script>([\s\S]*?)<\/script>/iu;
const script = html.match(scriptPattern)![1]!;

test("fixture script extraction accepts uppercase and mixed-case opening and closing tags", () => {
  for (const [opening, closing] of [
    ["<SCRIPT>", "</SCRIPT>"],
    ["<ScRiPt>", "</sCrIpT>"],
  ] as const) {
    const variant = html.replaceAll("<script>", opening).replaceAll("</script>", closing);
    assert.equal(variant.match(scriptPattern)?.[1], script);
  }
});

class Element {
  textContent = "";
  className = "";
  children: Element[] = [];
  onload?: () => void;
  onerror?: () => void;
  append(...children: Element[]) { this.children.push(...children); }
  text(): string { return [this.textContent, ...this.children.map((child) => child.text())].join(" "); }
}

async function probe(options: { cookie: string | Error; origin?: string; allowApis?: boolean }) {
  const rows = new Element();
  const summary = new Element();
  const allow = options.allowApis ?? false;
  const blocked = () => { throw new Error("SecurityError: sandbox blocked"); };
  const document = {
    getElementById: (id: string) => id === "probe-rows" ? rows : summary,
    createElement: () => new Element(),
    addEventListener: () => undefined,
    get cookie() {
      if (options.cookie instanceof Error) throw options.cookie;
      return options.cookie;
    },
    head: { append: (element: Element) => queueMicrotask(() => allow ? element.onload?.() : element.onerror?.()) },
  };
  class Image extends Element {
    set src(_value: string) { queueMicrotask(() => allow ? this.onload?.() : this.onerror?.()); }
  }
  class WebSocket extends Element {
    onopen?: () => void;
    constructor() {
      super();
      queueMicrotask(() => allow ? this.onopen?.() : this.onerror?.());
    }
  }
  const window = {
    get localStorage() { return allow ? { length: 1 } : blocked(); },
    top: {
      get document() { return allow ? { title: "HUI" } : blocked(); },
      location: { set href(_value: string) { blocked(); } },
    },
    open: () => allow ? {} : null,
  };
  await runInNewContext(script, {
    document, window, self: { origin: options.origin ?? "null" }, Image, WebSocket,
    fetch: async () => allow ? { status: 200, text: async () => "parent secret" } : blocked(),
    // The real page waits for CSP events; these deterministic API stubs finish on the next microtask.
    setTimeout: (callback: () => void) => queueMicrotask(callback),
  });
  return { rows: rows.children.map((row) => row.text().replace(/\s+/gu, " ").trim()), summary: summary.textContent };
}

for (const cookie of ["", new Error("SecurityError: opaque cookie access denied")]) {
  test(`the probe accepts an opaque cookie ${typeof cookie === "string" ? "empty read (WebKit)" : "exception (Chromium)"}`, async () => {
    const result = await probe({ cookie });
    assert.equal(result.rows.length, 10);
    for (const row of result.rows) assert.match(row, /Blocked/u);
    assert.equal(result.summary, "10/10 blocked");
  });
}

test("an opaque origin exposing any cookie is still ALLOWED, not a passing isolation result", async () => {
  const result = await probe({ cookie: "hui_widget_probe=sentinel" });
  assert.match(result.rows.find((row) => row.includes("Read HUI's cookies"))!, /ALLOWED read 25 characters/u);
  assert.equal(result.summary, "9/10 blocked");
});

test("even an empty same-origin cookie read fails the isolation probe", async () => {
  const result = await probe({ cookie: "", origin: "https://hui.test" });
  assert.match(result.rows.find((row) => row.includes("Read HUI's cookies"))!, /ALLOWED read 0 characters/u);
  assert.match(result.rows.find((row) => row.includes("Run in an opaque origin"))!, /ALLOWED/u);
  assert.equal(result.summary, "8/10 blocked");
});

test("working browser APIs and a real same-origin cookie leak cannot be reported as blocked", async () => {
  const result = await probe({ cookie: "hui_widget_probe=sentinel", origin: "https://hui.test", allowApis: true });
  for (const row of result.rows.filter((row) => !row.includes("Navigate the top window"))) {
    assert.match(row, /ALLOWED/u);
  }
  assert.equal(result.summary, "1/10 blocked");
});
