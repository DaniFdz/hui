/**
 * Agent-friendly key names ("Enter", "Shift+Tab", "Control+A", "a") mapped to
 * CDP `Input.dispatchKeyEvent` fields. Only keys a page can observe through
 * ordinary keyboard events are supported; browser shortcuts are not.
 */

export type KeyStroke = {
  key: string;
  code: string;
  keyCode: number;
  /** Printable text inserted by the key, absent for control keys and shortcuts. */
  text?: string;
  /** CDP bit mask: Alt 1, Control 2, Meta 4, Shift 8. */
  modifiers: number;
};

type KeyDefinition = { key: string; code: string; keyCode: number; text?: string };

const NAMED_KEYS: Record<string, KeyDefinition> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
};

const ALIASES: Record<string, string> = {
  return: "enter", esc: "escape", del: "delete", up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright",
};

const MODIFIERS: Record<string, number> = {
  alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8,
};

export class KeyParseError extends Error {}

function definition(name: string): KeyDefinition | undefined {
  const lower = name.toLowerCase();
  const named = NAMED_KEYS[ALIASES[lower] ?? lower];
  if (named) return named;
  const functionKey = /^f([1-9]|1[0-2])$/u.exec(lower);
  if (functionKey) {
    const number = Number(functionKey[1]);
    return { key: `F${number}`, code: `F${number}`, keyCode: 111 + number };
  }
  if ([...name].length !== 1) return undefined;
  if (/^[a-z]$/iu.test(name)) {
    const upper = name.toUpperCase();
    return { key: name, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: name };
  }
  if (/^[0-9]$/u.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
  return { key: name, code: "", keyCode: 0, text: name };
}

export function parseKey(input: string): KeyStroke {
  const value = input.trim();
  if (!value || value.length > 40) throw new KeyParseError("key must be a key name such as Enter, Tab, ArrowDown, a or Control+A.");
  // A trailing "+" names the plus key itself ("Control++").
  const parts = value.endsWith("++") ? [...value.slice(0, -2).split("+"), "+"] : value.split("+");
  const name = parts.pop() ?? "";
  let modifiers = 0;
  for (const part of parts) {
    const bit = MODIFIERS[part.trim().toLowerCase()];
    if (!bit) throw new KeyParseError(`Unknown modifier "${part}". Use Alt, Control, Meta or Shift.`);
    modifiers |= bit;
  }
  const key = definition(name.trim() || name);
  if (!key) throw new KeyParseError(`Unknown key "${name}".`);
  const shifted = (modifiers & 8) !== 0 && key.text && /^[a-z]$/u.test(key.text);
  const text = (modifiers & (1 | 2 | 4)) !== 0 ? undefined : shifted ? key.text!.toUpperCase() : key.text;
  return {
    key: shifted ? key.key.toUpperCase() : key.key,
    code: key.code,
    keyCode: key.keyCode,
    ...(text ? { text } : {}),
    modifiers,
  };
}
