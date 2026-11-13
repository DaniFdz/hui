/** Reads a target's appearance in one DOM frame, retaining semantic identity across keyboard/layout movement. */
export type LookTarget = {
  x: number; y: number; width: number; height: number;
  label: string | null; href: string | null; className: string | null; text: string | null;
};

/** Serialized into the page by the fixture; all dependencies must remain inside this function. */
export function readLook({ x, y, width, height, label, href, className, text }: LookTarget) {
  const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
  let element: Element | undefined;
  if (href !== null && !label) {
    // An implicit-name link has no aria-label. Its old box can move while the real keyboard resizes the page.
    // Match the actual anchor, not a same-text child or avatar, and refuse ambiguous identities.
    const links = [...document.querySelectorAll("a[href]")].filter((node) =>
      node.getAttribute("href") === href && node.getAttribute("class") === className && node.textContent === text
      && node.getClientRects().length > 0 && getComputedStyle(node).visibility === "visible");
    if (links.length !== 1) throw new Error(`look: expected one visible link with the target's identity, found ${links.length}`);
    element = links[0];
  } else if (label) {
    // A terminal's tiny input moves with its cursor and is not pointer-hit-testable.
    const roots: ParentNode[] = [document];
    const named: Element[] = [];
    for (let root = roots.pop(); root; root = roots.pop()) {
      named.push(...[...root.querySelectorAll("[aria-label]")].filter((node) => node.getAttribute("aria-label") === label && node.getClientRects().length > 0));
      for (const host of root.querySelectorAll("*")) if (host.shadowRoot) roots.push(host.shadowRoot);
    }
    if (named.length === 1) element = named[0];
  }
  element ??= document.elementsFromPoint(x + width / 2, y + height / 2).find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return same(rect.x, x) && same(rect.y, y) && same(rect.width, width) && same(rect.height, height);
  });
  if (!element) throw new Error("look: no uniquely named control or element has the target's box");
  const rgb = (color: string) => {
    const channels = /^(?:rgba?\(|color\(srgb )([\d.e-]+),? ([\d.e-]+),? ([\d.e-]+)/u.exec(color);
    if (!channels) throw new Error(`look: ${color} is not an sRGB colour`);
    const scale = color.startsWith("color(") ? 255 : 1;
    return channels.slice(1).map((value) => Math.round(Number(value) * scale)) as [number, number, number];
  };
  let behind: Element | null = element;
  while (behind && /^rgba\(.*, 0\)$|^color\(.* \/ 0\)$|^transparent$/u.test(getComputedStyle(behind).backgroundColor)) behind = behind.parentElement;
  if (!behind) throw new Error("look: nothing opaque is behind the target");
  const style = getComputedStyle(element);
  let opacity = 1;
  for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
  const fonts = style.fontFamily.split(",").map((family) => family.trim().replace(/^"(.*)"$/u, "$1"));
  const faces = [...document.fonts];
  const outerShadow = style.boxShadow.split(/,(?![^(]*\))/u).at(-1)!.trim();
  return {
    color: rgb(style.color),
    background: rgb(getComputedStyle(behind).backgroundColor),
    opacity,
    fonts,
    loaded: fonts.filter((family) => faces.some((face) => face.family === family && face.status === "loaded")
      && document.fonts.check(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} "${family}"`, element.textContent ?? "")),
    size: Number.parseFloat(style.fontSize),
    weight: Number(style.fontWeight),
    align: style.textAlign,
    ring: !element.matches(":focus-visible") ? null
      : style.outlineStyle !== "none" ? rgb(style.outlineColor)
      : outerShadow === "none" ? null : rgb(outerShadow),
  };
}
