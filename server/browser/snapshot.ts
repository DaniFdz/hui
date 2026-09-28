/**
 * Renders Chrome's accessibility tree as the indented role/name outline agents
 * read and act on, in the spirit of Playwright's ARIA snapshots:
 *
 *   - heading "Sign in" [level=1]
 *   - textbox "Email" [ref=e3]: user@example.com
 *   - button "Continue" [ref=e4]
 *
 * Interactive elements receive refs bound to a DOM node. A ref stays the same
 * for that node across snapshots of one document; a new document invalidates
 * every ref while numbering continues, so a stale ref can never silently
 * address an element on the next page.
 */

export type AxValue = { type?: string; value?: unknown };
export type AxProperty = { name: string; value?: AxValue };
export type AxNode = {
  nodeId: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: AxProperty[];
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
};

export type SnapshotTarget = { backendNodeId: number; role: string; name: string };

export class SnapshotRefs {
  #next = 0;
  readonly #byNode = new Map<number, string>();
  readonly #targets = new Map<string, SnapshotTarget>();

  reset(): void {
    this.#byNode.clear();
    this.#targets.clear();
  }

  refFor(target: SnapshotTarget): string {
    let ref = this.#byNode.get(target.backendNodeId);
    if (!ref) {
      ref = `e${++this.#next}`;
      this.#byNode.set(target.backendNodeId, ref);
    }
    this.#targets.set(ref, target);
    return ref;
  }

  target(ref: string): SnapshotTarget | undefined {
    return this.#targets.get(ref);
  }

  get size(): number {
    return this.#targets.size;
  }
}

export type SnapshotOptions = {
  /** Only elements with refs, without nesting. */
  interactive?: boolean;
  /** Keep lines containing every whitespace-separated token, ignoring case. */
  query?: string;
  maxChars?: number;
  /** Lets same-origin link targets print as short paths. */
  pageUrl?: string;
};

export type SnapshotResult = { text: string; lines: number; truncated: boolean; matched?: number };

export const SNAPSHOT_DEFAULT_CHARS = 12_000;
export const SNAPSHOT_MAX_CHARS = 40_000;

type Line = {
  kind: "line";
  role: string;
  name: string;
  attrs: string[];
  ref?: string;
  value?: string;
  inline?: string;
  children: View[];
};
type Text = { kind: "text"; text: string };
type View = Line | Text;

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option",
  "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "switch", "slider", "spinbutton", "treeitem",
  "DisclosureTriangle", "ToggleButton", "PopUpButton", "MenuListOption", "ColorWell", "Date", "DateTime", "InputTime",
]);
/** Their subtree is Chrome's inner editor and placeholder, not page content. */
const TEXT_INPUT_ROLES = new Set(["textbox", "searchbox", "spinbutton", "slider"]);
const VALUE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider", "ColorWell", "Date", "DateTime", "InputTime", "progressbar", "meter"]);
const SKIPPED_ROLES = new Set(["InlineTextBox", "LineBreak", "ListMarker"]);
const FLATTENED_ROLES = new Set([
  "generic", "none", "presentation", "LabelText", "Section", "RootWebArea", "WebArea",
  "LayoutTable", "LayoutTableRow", "LayoutTableCell", "Pre", "Ruby", "RubyAnnotation",
  "emphasis", "strong", "code", "subscript", "superscript", "mark", "time", "abbr", "deletion", "insertion",
]);
const NON_ACTIONABLE_FOCUSABLE = new Set(["RootWebArea", "WebArea", "Iframe"]);

function clean(value: unknown, maximum: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).replace(/\s+/gu, " ").trim();
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function joinText(left: string, right: string): string {
  // Flattened block containers carry no layout information; separate words
  // that would otherwise run together across element boundaries.
  return /[\p{L}\p{N}]$/u.test(left) && /^[\p{L}\p{N}]/u.test(right) ? `${left} ${right}` : left + right;
}

function shortUrl(raw: unknown, pageUrl: string | undefined): string {
  if (typeof raw !== "string" || !raw) return "";
  try {
    const url = new URL(raw);
    const page = pageUrl ? new URL(pageUrl) : undefined;
    const text = page && page.origin === url.origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
    return clean(text, 200);
  } catch {
    return clean(raw, 200);
  }
}

function attributes(role: string, properties: Map<string, unknown>, pageUrl: string | undefined): string[] {
  const attrs: string[] = [];
  const level = properties.get("level");
  if (role === "heading" && typeof level === "number") attrs.push(`level=${level}`);
  const checked = properties.get("checked");
  if (checked === true || checked === "true") attrs.push("checked");
  else if (checked === "mixed") attrs.push("checked=mixed");
  const pressed = properties.get("pressed");
  if (pressed === true || pressed === "true") attrs.push("pressed");
  else if (pressed === "mixed") attrs.push("pressed=mixed");
  if (properties.get("selected") === true) attrs.push("selected");
  if (properties.get("expanded") === true) attrs.push("expanded");
  if (properties.get("disabled") === true) attrs.push("disabled");
  if (properties.get("required") === true) attrs.push("required");
  const invalid = properties.get("invalid");
  if (typeof invalid === "string" && invalid !== "false") attrs.push("invalid");
  if (properties.get("readonly") === true && TEXT_INPUT_ROLES.has(role)) attrs.push("readonly");
  if (properties.get("modal") === true) attrs.push("modal");
  if (properties.get("focused") === true) attrs.push("focused");
  if (role === "link") {
    const url = shortUrl(properties.get("url"), pageUrl);
    if (url) attrs.push(`url=${url}`);
  }
  return attrs;
}

function build(
  id: string,
  nodes: ReadonlyMap<string, AxNode>,
  refs: SnapshotRefs,
  pageUrl: string | undefined,
  parentRole: string,
  depth: number,
  seen: Set<string>,
): View[] {
  const node = nodes.get(id);
  if (!node || seen.has(id) || depth > 400) return [];
  seen.add(id);
  const role = typeof node.role?.value === "string" ? node.role.value : "";
  const children = (): View[] => (node.childIds ?? []).flatMap((child) => build(child, nodes, refs, pageUrl, role, depth + 1, seen));
  if (node.ignored) return children();
  if (SKIPPED_ROLES.has(role)) return [];
  if (role === "StaticText") {
    const text = typeof node.name?.value === "string" ? node.name.value.replace(/\s+/gu, " ") : "";
    return text.trim() ? [{ kind: "text", text }] : [];
  }
  const properties = new Map((node.properties ?? []).map((property) => [property.name, property.value?.value]));
  const editable = properties.get("editable");
  // An input's inner editor repeats its value; a contenteditable root is itself the control.
  if (role === "generic" && editable !== undefined && (TEXT_INPUT_ROLES.has(parentRole) || parentRole === "combobox")) return [];
  const name = clean(node.name?.value, 150);
  const actionable = INTERACTIVE_ROLES.has(role)
    || (properties.get("focusable") === true && !NON_ACTIONABLE_FOCUSABLE.has(role))
    || (editable !== undefined && editable !== "" && role !== "RootWebArea");
  const ref = actionable && typeof node.backendDOMNodeId === "number"
    ? refs.refFor({ backendNodeId: node.backendDOMNodeId, role, name })
    : undefined;
  const nested = TEXT_INPUT_ROLES.has(role) ? [] : children();
  if (!ref && (FLATTENED_ROLES.has(role) || (role === "group" && !name))) return nested;
  const value = VALUE_ROLES.has(role) ? clean(node.value?.value, 200) : "";
  return [{
    kind: "line",
    role: role || "unknown",
    name,
    attrs: attributes(role, properties, pageUrl),
    ...(ref ? { ref } : {}),
    ...(value ? { value } : {}),
    children: nested,
  }];
}

function finalize(views: readonly View[]): View[] {
  const result: View[] = [];
  for (const view of views) {
    if (view.kind === "text") {
      const previous = result.at(-1);
      if (previous?.kind === "text") previous.text = joinText(previous.text, view.text);
      else result.push({ kind: "text", text: view.text });
      continue;
    }
    const children = finalize(view.children);
    const line: Line = { ...view, children };
    if (children.length > 0 && children.every((child) => child.kind === "text")) {
      const text = clean(children.map((child) => (child as Text).text).join(""), 300);
      line.children = [];
      const redundant = clean(text, 150).toLocaleLowerCase() === line.name.toLocaleLowerCase();
      if (text && !redundant && !line.value) line.inline = text;
    }
    const meaningful = line.name || line.ref || line.value || line.inline || line.children.length > 0 || line.role === "separator";
    if (meaningful) result.push(line);
  }
  return result.filter((view) => view.kind === "line" || view.text.trim());
}

function describe(line: Line): string {
  const name = line.name ? ` ${JSON.stringify(line.name)}` : "";
  const attrs = line.attrs.map((attr) => ` [${attr}]`).join("");
  const ref = line.ref ? ` [ref=${line.ref}]` : "";
  const content = line.value ?? line.inline;
  return `- ${line.role}${name}${ref}${attrs}${content ? `: ${content}` : ""}`;
}

function print(views: readonly View[], depth: number, interactive: boolean, out: string[]): void {
  for (const view of views) {
    if (view.kind === "text") {
      if (!interactive) out.push(`${"  ".repeat(depth)}- text: ${clean(view.text, 300)}`);
      continue;
    }
    if (!interactive) out.push(`${"  ".repeat(depth)}${describe(view)}`);
    else if (view.ref) out.push(describe(view));
    print(view.children, interactive ? 0 : Math.min(depth + 1, 40), interactive, out);
  }
}

export function clampSnapshotChars(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(SNAPSHOT_MAX_CHARS, Math.max(500, Math.floor(value)))
    : SNAPSHOT_DEFAULT_CHARS;
}

/** Pure: `refs` is the only state it touches. */
export function renderSnapshot(axNodes: readonly AxNode[], refs: SnapshotRefs, options: SnapshotOptions = {}): SnapshotResult {
  const nodes = new Map(axNodes.map((node) => [node.nodeId, node]));
  const roots = axNodes.filter((node) => !node.parentId || !nodes.has(node.parentId));
  const seen = new Set<string>();
  const views = finalize(roots.flatMap((root) => build(root.nodeId, nodes, refs, options.pageUrl, "", 0, seen)));
  let lines: string[] = [];
  print(views, 0, options.interactive === true, lines);
  let matched: number | undefined;
  const tokens = (options.query ?? "").toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length) {
    lines = lines.filter((line) => {
      const haystack = line.toLocaleLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
    matched = lines.length;
  }
  const maxChars = clampSnapshotChars(options.maxChars);
  let text = "";
  let truncated = false;
  let count = 0;
  for (const line of lines) {
    if (text.length + line.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    text += `${line}\n`;
    count += 1;
  }
  return { text: text.trimEnd(), lines: count, truncated, ...(matched !== undefined ? { matched } : {}) };
}
