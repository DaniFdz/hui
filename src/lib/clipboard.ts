export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

interface ClipboardOptions {
  clipboard?: ClipboardWriter | null;
  legacyCopy?: (text: string) => boolean;
}

function legacyCopyText(text: string): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : [];
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    position: "fixed",
    inset: "0 auto auto -9999px",
    width: "1px",
    height: "1px",
    opacity: "0",
  });
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
    active?.focus({ preventScroll: true });
  }
  return copied;
}

/** Copies in secure contexts and retains a user-gesture fallback for HTTP/LAN UI. */
export async function writeClipboardText(text: string, options: ClipboardOptions = {}): Promise<boolean> {
  const clipboard = "clipboard" in options ? options.clipboard : globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permission policy and insecure remote origins can reject the modern API.
    }
  }
  return (options.legacyCopy ?? legacyCopyText)(text);
}

export type ImageCopyResult = "image" | "html" | false;

interface ImageClipboardOptions {
  clipboard?: Pick<Clipboard, "write"> | null;
  /** Builds the async PNG item; absent where ClipboardItem is unsupported. */
  createItem?: ((png: Promise<Blob>) => ClipboardItem) | null;
  legacyCopy?: (png: Promise<Blob>) => Promise<boolean>;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Image could not be read.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

/** Copies a selected inline image as rich text for origins without async clipboard. */
async function legacyCopyImage(png: Promise<Blob>): Promise<boolean> {
  const source = await blobToDataUrl(await png);
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.setAttribute("aria-hidden", "true");
  Object.assign(holder.style, { position: "fixed", inset: "0 auto auto -9999px", opacity: "0" });
  const image = document.createElement("img");
  image.src = source;
  holder.append(image);
  // The modal dialog makes the rest of the document inert; stay inside it.
  (active?.closest("dialog[open]") ?? document.body).append(holder);
  const selection = document.getSelection();
  const range = document.createRange();
  range.selectNode(image);
  selection?.removeAllRanges();
  selection?.addRange(range);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    selection?.removeAllRanges();
    holder.remove();
    active?.focus({ preventScroll: true });
  }
}

function defaultCreateItem(): ((png: Promise<Blob>) => ClipboardItem) | null {
  if (typeof ClipboardItem === "undefined") return null;
  return (png) => new ClipboardItem({ "image/png": png });
}

/**
 * Copies a PNG as an image where the async Clipboard API exists (secure
 * contexts); otherwise falls back to a rich-text image selection. The PNG is a
 * promise so the clipboard write starts inside the user's activation.
 */
export async function writeClipboardImage(png: Promise<Blob>, options: ImageClipboardOptions = {}): Promise<ImageCopyResult> {
  const clipboard = "clipboard" in options ? options.clipboard : globalThis.navigator?.clipboard;
  const createItem = "createItem" in options ? options.createItem : defaultCreateItem();
  if (clipboard?.write && createItem) {
    try {
      await clipboard.write([createItem(png)]);
      return "image";
    } catch {
      // Permission policy or an unsupported type; try the selection fallback.
    }
  }
  try {
    return await (options.legacyCopy ?? legacyCopyImage)(png) ? "html" : false;
  } catch {
    return false;
  }
}
