/**
 * Scroll geometry for a session's pull request strip.
 *
 * The strip is a `row-reverse` scroller with the newest mark first in the DOM,
 * so the newest mark sits at the trailing edge and that edge is the scroll
 * origin: `scrollLeft` is 0 there and grows negative toward older marks.
 * `Math.abs` also accepts engines that still report positive offsets.
 */
export type StripOverflow = { before: boolean; after: boolean };

function scrollRange(scrollLeft: number, scrollWidth: number, clientWidth: number) {
  const max = Math.max(0, scrollWidth - clientWidth);
  return { max, offset: Math.min(max, Math.abs(scrollLeft)) };
}

/** Older marks hidden on the leading side (`before`) or newer ones scrolled
 * past on the trailing side (`after`). One pixel absorbs subpixel rounding. */
export function stripOverflow(scrollLeft: number, scrollWidth: number, clientWidth: number): StripOverflow {
  const { max, offset } = scrollRange(scrollLeft, scrollWidth, clientWidth);
  if (max <= 1) return { before: false, after: false };
  return { before: max - offset > 1, after: offset > 1 };
}

/** A vertical wheel reveals older marks when moving down and newer ones when
 * moving up. Returns the next `scrollLeft`, or `undefined` at that end so the
 * sidebar keeps scrolling instead of the wheel being swallowed. */
export function stripWheelScroll(scrollLeft: number, scrollWidth: number, clientWidth: number, deltaY: number): number | undefined {
  const { max, offset } = scrollRange(scrollLeft, scrollWidth, clientWidth);
  if (max <= 1 || deltaY === 0) return undefined;
  const next = Math.min(max, Math.max(0, offset + deltaY));
  return Math.abs(next - offset) < 0.5 ? undefined : -next;
}
