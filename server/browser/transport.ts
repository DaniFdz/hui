/** Encodes the managed browser live view's binary screencast frames. */

export type BrowserFrameHeader = { tabId: string; width: number; height: number; seq: number };

export function encodeBrowserFrame(header: BrowserFrameHeader, image: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + json.length + image.length);
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  out.set(image, 4 + json.length);
  return out;
}
