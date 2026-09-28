import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Dependency-free application artwork: HUI monogram, not a borrowed logo. */
export function appIcon() {
  const size = 256;
  const rows = Buffer.alloc(size * (size * 4 + 1));
  const letters = ['10101010111', '10101010010', '11101010010', '10101010010', '10101110111'];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.max(24 - x, x - 231, 0);
    const dy = Math.max(24 - y, y - 231, 0);
    const visible = dx * dx + dy * dy < 24 * 24;
    const col = Math.floor((x - 40) / 16);
    const row = Math.floor((y - 88) / 16);
    const ink = row >= 0 && row < 5 && col >= 0 && col < 11 && letters[row][col] === '1';
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    rows.set(ink ? [250, 250, 255, 255] : [45, 39, 91, visible ? 255 : 0], offset);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  const icnsHeader = Buffer.alloc(16);
  icnsHeader.write('icns'); icnsHeader.writeUInt32BE(png.length + 16, 4);
  icnsHeader.write('ic08', 8); icnsHeader.writeUInt32BE(png.length + 8, 12);
  return { png, icns: Buffer.concat([icnsHeader, png]) };
}
