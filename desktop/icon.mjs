import { readFileSync } from 'node:fs';

/** HUI application artwork: a 256×256 PNG rendered from docs/assets/icon.html, plus its icns wrapper. */
export function appIcon() {
  const png = readFileSync(new URL('./icon.png', import.meta.url));
  const icnsHeader = Buffer.alloc(16);
  icnsHeader.write('icns'); icnsHeader.writeUInt32BE(png.length + 16, 4);
  icnsHeader.write('ic08', 8); icnsHeader.writeUInt32BE(png.length + 8, 12);
  return { png, icns: Buffer.concat([icnsHeader, png]) };
}
