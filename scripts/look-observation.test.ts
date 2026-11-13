/** Guards the appearance observer's semantic link identity when a keyboard/layout moves a previously read box. */
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { readLook, type LookTarget } from "../e2e/fixtures/look.ts";

const target: LookTarget = {
  x: 50, y: 700, width: 40, height: 15, label: null,
  href: "/bots/grace", className: "chat-sender-name chat-sender-link", text: "Grace",
};
const moved = { x: 50, y: 190, width: 40, height: 15 };
const style = {
  color: "rgb(60, 179, 113)", backgroundColor: "rgb(255, 255, 255)", visibility: "visible",
  opacity: "1", fontFamily: "sans-serif", boxShadow: "none", fontSize: "12px", fontWeight: "500", textAlign: "start",
};
function anchor(patch: Partial<LookTarget> = {}) {
  const identity = { ...target, ...patch };
  const attributes: Record<string, string | null> = { href: identity.href, class: identity.className };
  return {
    getAttribute: (name: string) => attributes[name] ?? null,
    textContent: identity.text, getClientRects: () => [moved], getBoundingClientRect: () => moved,
    matches: () => false, parentElement: null,
  };
}
function page(links: ReturnType<typeof anchor>[], hosts: { shadowRoot: { querySelectorAll: (selector: string) => unknown[] } }[] = []) {
  const hitTest = vi.fn(() => []);
  vi.stubGlobal("document", {
    querySelectorAll: (selector: string) => selector === "a[href]" ? links : selector === "*" ? hosts : [],
    elementsFromPoint: hitTest,
    fonts: Object.assign([], { check: () => false }),
  });
  vi.stubGlobal("getComputedStyle", () => style);
  return hitTest;
}
afterEach(() => { vi.unstubAllGlobals(); style.color = "rgb(60, 179, 113)"; });

test("a real anchor moved from the old box retains its identity and live color, without geometry fallback", () => {
  const hitTest = page([anchor()]);
  // Counterexample: the old centre no longer hits the link after the keyboard resizes the viewport.
  assert.deepEqual(document.elementsFromPoint(target.x + target.width / 2, target.y + target.height / 2), []);
  assert.notEqual(moved.y, target.y);
  hitTest.mockClear();
  assert.deepEqual(readLook(target).color, [60, 179, 113]);
  style.color = "rgb(138, 124, 240)";
  assert.deepEqual(readLook(target).color, [138, 124, 240]);
  assert.equal(hitTest.mock.calls.length, 0);
  assert.throws(() => readLook({ ...target, href: null }), /no uniquely named control/u, "the old box-only observer fails this counterexample");
});

test("template whitespace between a link's parts is formatting, not identity", () => {
  const spaced = anchor({ text: " \n    \n                  Appearance\n                " });
  page([spaced]);
  assert.deepEqual(readLook({ ...target, text: "Appearance" }).color, [60, 179, 113]);
  assert.throws(() => readLook({ ...target, text: "Notifications" }), /expected one visible link.*found 0/u);
});

test("a link inside a shadow root is matched by the same identity, and a duplicate across roots still fails", () => {
  const inside = anchor();
  const hitTest = page([], [{ shadowRoot: { querySelectorAll: (selector) => selector === "a[href]" ? [inside] : [] } }]);
  assert.deepEqual(readLook(target).color, [60, 179, 113]);
  assert.equal(hitTest.mock.calls.length, 0, "the shadow match is semantic, not a geometry fallback");
  page([anchor()], [{ shadowRoot: { querySelectorAll: (selector) => selector === "a[href]" ? [inside] : [] } }]);
  assert.throws(() => readLook(target), /expected one visible link.*found 2/u, "an ambiguous identity across roots is refused");
});

test("duplicate matching links fail rather than selecting the first or falling back to a box", () => {
  const hitTest = page([anchor(), anchor()]);
  assert.throws(() => readLook(target), /expected one visible link.*found 2/u);
  assert.equal(hitTest.mock.calls.length, 0);
});

test.each([
  { href: "/bots/another" }, { className: "bot-avatar" }, { text: "Ada" },
])("a mismatched anchor identity fails: %j", (patch) => {
  page([anchor(patch)]);
  assert.throws(() => readLook(target), /expected one visible link.*found 0/u);
});
