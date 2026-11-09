/**
 * Spike S3 only (docs/mobile-app-plan.md): reads a simulator screenshot and asserts which page the app is showing,
 * by the photo-frame colour the probe page paints. No image library on the runner, so this decodes the PNG itself
 * (8-bit truecolour, no interlacing) and only samples a grid of pixels.
 *
 *   node mobile/ios/s3-probe/check-screenshot.mjs <file.png> <green|red> [timeoutSeconds]
 *
 * Polls the file until it shows the expected colour, so a slow render waits instead of failing on a fixed sleep.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

function decode(path) {
  const buffer = readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit, non-interlaced PNGs are supported");
      colorType = data[9];
    } else if (type === "IDAT") chunks.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0;
      const above = previous[x];
      const corner = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + left) & 255;
      else if (filter === 2) line[x] = (line[x] + above) & 255;
      else if (filter === 3) line[x] = (line[x] + ((left + above) >> 1)) & 255;
      else if (filter === 4) {
        const estimate = left + above - corner;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - above);
        const pc = Math.abs(estimate - corner);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? above : corner)) & 255;
      }
    }
    line.copy(pixels, y * stride);
    previous = line;
  }
  return { width, height, channels, pixels };
}

/** The share of sampled pixels that are clearly green or clearly red, ignoring text and the status bar. */
function families({ width, height, channels, pixels }) {
  let green = 0;
  let red = 0;
  let total = 0;
  for (let y = Math.floor(height * 0.2); y < height * 0.8; y += 8) {
    for (let x = Math.floor(width * 0.1); x < width * 0.9; x += 8) {
      const index = (y * width + x) * channels;
      const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
      total++;
      if (g > 80 && g - r > 40 && g - b > 40) green++;
      else if (r > 80 && r - g > 40 && r - b > 40) red++;
    }
  }
  return { green: green / total, red: red / total, total };
}

const [file, expected, timeout = "40"] = process.argv.slice(2);
if (!file || !["green", "red"].includes(expected ?? "")) {
  console.error("usage: check-screenshot.mjs <file.png> <green|red> [timeoutSeconds]");
  process.exit(2);
}

const deadline = Date.now() + Number(timeout) * 1000;
for (;;) {
  try {
    const share = families(decode(file));
    // The probe paints green when Capacitor's bridge is on the loaded origin and red when it is not.
    const pass = share[expected] > 0.3 && share[expected] > share[expected === "green" ? "red" : "green"];
    const line = `${file}: green=${share.green.toFixed(2)} red=${share.red.toFixed(2)} expected=${expected}`;
    if (pass) {
      console.log(`ok ${line}`);
      process.exit(0);
    }
    console.log(`waiting ${line}`);
  } catch (error) {
    console.log(`waiting for ${file}: ${error.message}`);
  }
  if (Date.now() > deadline) {
    console.error(`FAILED: ${file} never showed a ${expected} page`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
