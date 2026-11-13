/** Directory completion's popup transport and focus lifecycle, independent of the caller's directory state. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, vi } from "vitest";
import { renderDirectoryPicker } from "./directory-picker.ts";

const props = { id: "folder", label: "Folder", value: "/repo", suggestions: ["/repo"], inputClass: "field", onInput: vi.fn() };

test("directory completion stays outside the centered dialog's flow", () => {
  const template = renderDirectoryPicker(props);
  const suggestions = template.values.at(-1) as { strings: readonly string[] };
  assert.match(suggestions.strings.join(""), /<wa-popup/);
  const css = readFileSync(new URL("../styles/openclaw-launch.css", import.meta.url), "utf8");
  assert.match(css, /\.new-session-page__directory-menu \{[^}]*position: static;/);
  assert.doesNotMatch(css, /\.group-action-dialog \.new-session-page__directory-menu\s*\{/);
});

test("leaving completion closes its popup without changing a valid typed folder; option focus keeps it open", () => {
  class FakeNode {}
  class FakeElement extends FakeNode {
    input = { setAttribute: vi.fn(), value: "/repo" };
    querySelector() { return this.input; }
    contains(target: unknown) { return target === option; }
  }
  const option = new FakeNode();
  const picker = new FakeElement();
  const popup = { active: true };
  Object.assign(picker.input, { closest: () => ({ querySelector: () => popup }) });
  vi.stubGlobal("Node", FakeNode);
  vi.stubGlobal("HTMLElement", FakeElement);
  const template = renderDirectoryPicker(props);
  const index = template.strings.findIndex((part) => part.endsWith("@focusout="));
  const focusout = template.values[index] as (event: unknown) => void;
  focusout({ currentTarget: picker, relatedTarget: option });
  assert.equal(popup.active, true);
  focusout({ currentTarget: picker, relatedTarget: new FakeNode() });
  assert.equal(popup.active, false);
  assert.equal(picker.input.value, "/repo");
  assert.deepEqual(picker.input.setAttribute.mock.calls, [["aria-expanded", "false"]]);
  assert.equal(props.onInput.mock.calls.length, 0);
});
