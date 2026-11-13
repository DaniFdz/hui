/**
 * HUI's page-side shell helpers. The app injects this into the gateway's own page (`ShellPage.java`); it is not part of
 * the web UI and it is never bundled with it.
 *
 * <p>It exists for the two things a WebView cannot do on its own:
 * <ul>
 *   <li>Save a download the page made itself. The web UI's downloads are `blob:` object URLs with the file's name in
 *   the anchor's `download` attribute (`src/lib/download.ts`, `src/api/observability.ts`), and neither the WebView's
 *   DownloadListener nor the system download manager can read a blob or learn that name. The anchor's click is taken
 *   here, the bytes are read in the page and handed to the app, which writes them to Downloads.</li>
 *   <li>Hand a plain `http(s)` download to the app with the name the anchor carries, so the saved file is the one the
 *   page offered rather than whatever the URL's last segment happens to be.</li>
 * </ul>
 * And for the one thing the app cannot do from native code: when the app pads the page's frame with the system insets
 * (`ShellWindow`, API 30 and later), the page's own safe-area tokens are zeroed here, because the same inset counted
 * twice is a cutout device with a double gap.
 * Every failure goes to the app too: it says what happened, in one toast.
 */
(function () {
  if (window.__huiShell) return;

  /**
   * The most one download may carry, matching the app's own bound (`ShellDownloads.MAX_BYTES`). The bytes cross the
   * bridge as one base64 string, so this is what keeps a page from making the app hold a third again of a huge file.
   */
  const MAX_BYTES = 16 * 1024 * 1024;

  const call = (method, options) => {
    if (!window.Capacitor || !window.Capacitor.nativePromise) return Promise.reject(new Error("the app is not reachable"));
    return window.Capacitor.nativePromise("HuiShell", method, options);
  };
  const failed = (error) => {
    console.warn("HUI could not save the download", error);
    call("report", { message: "HUI could not save that download." }).catch(() => {});
  };

  /** The page's bytes as base64, in chunks: one `fromCharCode` over a whole file overflows the stack. */
  const toBase64 = (bytes) => {
    let text = "";
    const chunk = 0x8000;
    for (let at = 0; at < bytes.length; at += chunk) text += String.fromCharCode.apply(null, bytes.subarray(at, at + chunk));
    return btoa(text);
  };

  /**
   * The blobs behind the object URLs the page made. The web UI revokes its object URL as soon as it has clicked the
   * anchor, so fetching the URL afterwards would fail; the blob itself is still here. Only a short window is kept: the
   * page also makes object URLs for images it never downloads, and holding those would grow with the conversation. A
   * revoked URL is dropped at once, which is the page saying it is done with it.
   */
  const blobs = new Map();
  const KEEP_MS = 60_000;
  const KEEP_MAX = 16;
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = createObjectURL(blob);
    const now = Date.now();
    for (const [key, entry] of blobs) if (now - entry.at > KEEP_MS || blobs.size >= KEEP_MAX) blobs.delete(key);
    blobs.set(url, { blob, at: now });
    return url;
  };
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => {
    blobs.delete(url);
    revokeObjectURL(url);
  };

  /** Save one URL the page owns (`blob:`/`data:`) as `name`. */
  const save = async (url, name) => {
    const remembered = blobs.get(url);
    blobs.delete(url);
    let blob = remembered && remembered.blob;
    if (!blob) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      blob = await response.blob();
    }
    // Before reading a byte of it: the app would refuse this anyway, and this is what keeps the page from building the
    // base64 copy first.
    if (blob.size > MAX_BYTES) {
      call("report", { message: `HUI can't save a download larger than ${MAX_BYTES / 1024 / 1024} MiB.` }).catch(() => {});
      return null;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return call("saveDownload", { name: name || "", type: blob.type || "application/octet-stream", data: toBase64(bytes) });
  };

  window.__huiShell = { save: (url, name) => save(url, name).catch(failed) };

  /**
   * The page's own `--safe-area-*` tokens come from `env(safe-area-inset-*)` (`src/styles/openclaw-reference/base.css`).
   * The app sets this flag when it pads the page's frame itself, and then the shell is the owner of every inset: leaving
   * the tokens at the device's values would pad the page a second time on a device with a cutout. An inline style on the
   * root outranks the `:root` rule, and a single-page navigation does not replace the element it sits on.
   */
  if (window.__huiShellOwnInsets) {
    for (const side of ["top", "right", "bottom", "left"]) document.documentElement.style.setProperty(`--safe-area-${side}`, "0px");
  }

  /** The anchor's own name, or the last segment of its URL, which the app would fall back to anyway. */
  const nameOf = (anchor) => {
    const named = (anchor.getAttribute("download") || "").trim();
    if (named) return named;
    try {
      return decodeURIComponent(new URL(anchor.href).pathname.split("/").filter(Boolean).pop() || "");
    } catch {
      return "";
    }
  };

  /** Take one download anchor, or answer `false` to let the WebView and the system have it. */
  const take = (anchor) => {
    const href = anchor.href;
    if (!href) return false;
    const own = /^(blob:|data:)/i.test(href);
    const sameOrigin = href.startsWith(`${location.origin}/`);
    // Another origin: the WebView's DownloadListener and the system download manager handle it, cookies and all.
    if (!own && !sameOrigin) return false;
    const name = nameOf(anchor);
    if (own) save(href, name).catch(failed);
    else call("downloadUrl", { url: href, name }).catch(failed);
    return true;
  };

  // A click the user makes on a download link in the page.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      const anchor = target && target.closest ? target.closest("a[download]") : null;
      if (!anchor || !take(anchor)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  // A click the page makes itself. The web UI clicks anchors it never attached to the document, so their click never
  // reaches `document`: the prototype is the only place to see them.
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute("download") && take(this)) return;
    return click.call(this);
  };
})();
