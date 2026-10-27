import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { handleCodeBlockCopy, handleCodeBlockDisclosure, updateCodeBlockWidthOverflow } from "./blocks.ts";

function fixture() {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const code = { scrollWidth: 500 };
  const viewport = { clientWidth: 200, querySelector: () => code };
  const wrapper = {
    classList: {
      contains: (name: string) => classes.has(name),
      add: (name: string) => classes.add(name),
      toggle(name: string, force = !classes.has(name)) {
        if (force) classes.add(name); else classes.delete(name);
        return force;
      },
    },
    querySelector: () => viewport,
  };
  const button = { title: "", setAttribute: (name: string, value: string) => attributes.set(name, value) };
  const target = (action: string) => ({ closest: (selector: string) => selector === ".code-block-wrapper" ? wrapper : selector === action ? button : null }) as unknown as Element;
  return { classes, attributes, code, viewport, button, target, wrapper: wrapper as unknown as HTMLElement };
}

test("code overflow offers wrapping only when the original one-pixel threshold is crossed", () => {
  const f = fixture();
  updateCodeBlockWidthOverflow(f.wrapper);
  assert.ok(f.classes.has("has-horizontal-overflow"));
  f.code.scrollWidth = 201;
  updateCodeBlockWidthOverflow(f.wrapper);
  assert.ok(!f.classes.has("has-horizontal-overflow"));
  f.code.scrollWidth = 202;
  updateCodeBlockWidthOverflow(f.wrapper);
  assert.ok(f.classes.has("has-horizontal-overflow"));
});

test("code reveal and wrap controls update actual state and accessible labels", () => {
  const f = fixture();
  handleCodeBlockDisclosure(f.target(".code-block-expand"));
  assert.ok(f.classes.has("is-expanded"));
  assert.equal(f.attributes.get("aria-expanded"), "true");
  handleCodeBlockDisclosure(f.target(".code-block-wrap"));
  assert.ok(f.classes.has("is-wrapped"));
  assert.ok(!f.classes.has("has-horizontal-overflow"));
  assert.equal(f.attributes.get("aria-pressed"), "true");
  assert.equal(f.button.title, "Disable word wrap");
  handleCodeBlockDisclosure(f.target(".code-block-wrap"));
  assert.ok(!f.classes.has("is-wrapped"));
  assert.ok(f.classes.has("has-horizontal-overflow"));
  assert.equal(f.attributes.get("aria-pressed"), "false");
  assert.equal(f.button.title, "Enable word wrap");
});

function copyFixture(text: string) {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const wrapper = { querySelector: () => ({ textContent: text }) };
  const button = {
    isConnected: true,
    classList: {
      toggle: (name: string, force: boolean) => { if (force) classes.add(name); else classes.delete(name); },
      remove: (...names: string[]) => { for (const name of names) classes.delete(name); },
    },
    closest: () => wrapper,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  };
  return {
    classes,
    attributes,
    target: { closest: (selector: string) => selector === "[data-copy-code]" ? button : null } as unknown as Element,
  };
}

test("copying a code block drops the trailing newline and reports the state on the button", async () => {
  vi.useFakeTimers();
  const f = copyFixture("const value = 1;\n");
  const written: string[] = [];
  await handleCodeBlockCopy(f.target, (text) => { written.push(text); return true; });
  assert.deepEqual(written, ["const value = 1;"]);
  assert.ok(f.classes.has("copied"));
  assert.equal(f.attributes.get("aria-label"), "Copied");
  vi.advanceTimersByTime(1500);
  assert.ok(!f.classes.has("copied"));
  assert.equal(f.attributes.get("aria-label"), "Copy code");
  vi.useRealTimers();
});

test("a refused clipboard write reads Copy failed on the button", async () => {
  vi.useFakeTimers();
  const f = copyFixture("value");
  await handleCodeBlockCopy(f.target, () => false);
  assert.ok(f.classes.has("copy-failed"));
  assert.equal(f.attributes.get("aria-label"), "Copy failed");
  vi.advanceTimersByTime(2000);
  assert.ok(!f.classes.has("copy-failed"));
  assert.equal(f.attributes.get("aria-label"), "Copy code");
  vi.useRealTimers();
});
