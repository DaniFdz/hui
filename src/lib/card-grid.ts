/**
 * How a page's stack of overview cards shares its rows. The column count follows the number of cards the page
 * shows, so a row never trails off with one lonely card: six cards make three columns, not four and two.
 * `.hui-card-grid` reads the values this module returns for the wide, compact and phone layouts.
 */

/** The most columns a wide layout shows, whatever the card count. */
export const CARD_GRID_MAX_COLUMNS = 4;
/** Columns kept once the layout is too narrow for the full count. */
export const CARD_GRID_COMPACT_COLUMNS = 2;
export const CARD_GRID_PHONE_COLUMNS = 1;

/**
 * The columns `cards` cards use, at most `maxColumns`. The tallest full row that still leaves every other row as
 * full as possible wins: 6 cards over 4 columns keep 3 columns (2 rows of 3), 5 cards keep 3 (3 and 2), 7 keep 4
 * (4 and 3) and 9 keep 3 (3 rows of 3).
 */
export function cardGridColumns(cards: number, maxColumns: number = CARD_GRID_MAX_COLUMNS): number {
  const total = Math.max(0, Math.trunc(cards));
  const limit = Math.max(1, Math.trunc(maxColumns));
  if (total <= limit) return Math.max(1, total);
  return Math.ceil(total / Math.ceil(total / limit));
}

/** The custom properties a `.hui-card-grid` reads, for a Lit `style` attribute. */
export function cardGridStyle(cards: number): string {
  return [
    `--hui-card-grid-columns:${cardGridColumns(cards, CARD_GRID_MAX_COLUMNS)}`,
    `--hui-card-grid-columns-compact:${cardGridColumns(cards, CARD_GRID_COMPACT_COLUMNS)}`,
    `--hui-card-grid-columns-phone:${cardGridColumns(cards, CARD_GRID_PHONE_COLUMNS)}`,
  ].join(";");
}
