/**
 * Image generation on a Google account through the Gemini web app, driven in HUI's own Chromium profile. Google
 * authorizes no API for an AI Pro/Ultra subscription, so the app itself is the only route: the operator signs in
 * once, and this provider asks the app for an image and reads it back out of the answer. The page is untrusted and
 * its markup changes, so every step reports what it saw instead of failing silently.
 */
import { MediaProviderError, type GeneratedMedia, type MediaKind, type MediaProvider, type MediaRequest } from "./provider.ts";

export const GEMINI_APP_URL = "https://gemini.google.com/app";

/** The one tab-side port this provider needs: HUI's managed browser for the calling conversation. */
export type GeminiPage = {
  /** Whether HUI's browser tool is turned on at all. */
  enabled(): Promise<boolean>;
  open(url: string): Promise<void>;
  evaluate(expression: string, options?: { timeoutMs?: number }): Promise<unknown>;
};

/** The app answers one image per prompt; the model and its resolution follow the account's plan. */
export const GEMINI_APP_MODEL = "gemini-app";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const POLL_INTERVAL_MS = 2_000;
const ANSWER_TIMEOUT_MS = 180_000;

/** `{ signedIn, composer, title, url }` for the app as it is right now. */
const PROBE = `(() => {
  const composer = document.querySelector('rich-textarea [contenteditable="true"], [contenteditable="true"][role="textbox"], textarea');
  const signIn = document.querySelector('a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/signin"]');
  return { signedIn: !signIn && Boolean(composer), composer: Boolean(composer), title: document.title, url: location.href };
})()`;

/** Focuses the composer, types the prompt and sends it. Gemini's editor is a rich-text field, so it gets both the
 * selection and an `insertText` command before the send button is clicked. */
function ask(prompt: string): string {
  return `(() => {
  const text = ${JSON.stringify(prompt)};
  const composer = document.querySelector('rich-textarea [contenteditable="true"], [contenteditable="true"][role="textbox"], textarea');
  if (!composer) return { submitted: false, reason: "no composer" };
  composer.focus();
  if (composer.tagName === "TEXTAREA") {
    composer.value = text;
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    const range = document.createRange();
    range.selectNodeContents(composer);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("insertText", false, text)) {
      composer.textContent = text;
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    }
  }
  const send = document.querySelector('button[aria-label*="Send" i], button[aria-label*="Enviar" i], button.send-button, button[type="submit"]');
  if (!send) return { submitted: false, reason: "no send button" };
  send.click();
  return { submitted: true, sent: composer.innerText || composer.value || "" };
})()`;
}

/** `{ generating, images, text }`: every candidate image in the answer, largest first, and whether the app is still
 * working on the reply. */
const ANSWER = `(() => {
  const root = document.querySelector("main, [role=main]") || document.body;
  const generating = Boolean(root.querySelector('button[aria-label*="Stop" i], [aria-busy="true"]'));
  const images = Array.from(root.querySelectorAll("img"))
    .map((img) => ({ src: img.currentSrc || img.src || "", width: img.naturalWidth || 0, height: img.naturalHeight || 0 }))
    .filter((image) => image.src && image.width > 64 && image.height > 64 && !/googleusercontent\\.com\\/a\\//u.test(image.src))
    .sort((a, b) => b.width * b.height - a.width * a.height);
  return { generating, images, text: (root.innerText || "").slice(0, 600) };
})()`;

/** Reads one image back into the page's own session, so the signed-in cookies are never handed to HUI. */
function readImage(src: string): string {
  return `(async () => {
  const response = await fetch(${JSON.stringify(src)}, { credentials: "include" });
  if (!response.ok) return { ok: false, reason: "HTTP " + response.status };
  const blob = await response.blob();
  if (blob.size > ${MAX_IMAGE_BYTES}) return { ok: false, reason: "image is larger than 32 MB" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return { ok: true, mimeType: blob.type || "image/png", data: btoa(binary) };
})()`;
}

type Probe = { signedIn?: unknown; composer?: unknown; title?: unknown; url?: unknown };
type Answer = { generating?: unknown; images?: unknown; text?: unknown };
type Read = { ok?: unknown; mimeType?: unknown; data?: unknown; reason?: unknown };

function imageList(value: Answer): Array<{ src: string; width: number; height: number }> {
  if (!Array.isArray(value.images)) return [];
  return value.images.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const image = entry as Record<string, unknown>;
    return typeof image["src"] === "string" && image["src"]
      ? [{ src: image["src"], width: Number(image["width"]) || 0, height: Number(image["height"]) || 0 }]
      : [];
  });
}

export function geminiAppProvider(options: {
  page: () => Promise<GeminiPage | undefined>;
  /** How long to wait for the app's answer; tests shorten it. */
  answerTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): MediaProvider {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeout = options.answerTimeoutMs ?? ANSWER_TIMEOUT_MS;
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  return {
    id: "gemini-web",
    name: "Google Gemini (account)",
    kinds: ["image"],
    models: (kind: MediaKind) => (kind === "image" ? [GEMINI_APP_MODEL] : []),
    async available() {
      const page = await options.page();
      return page !== undefined && (await page.enabled());
    },
    async generate(input: MediaRequest): Promise<GeneratedMedia> {
      if (input.kind !== "image") throw new MediaProviderError("The Gemini app generates images here, not videos.");
      const page = await options.page();
      if (!page) throw new MediaProviderError("The Gemini account route needs HUI's browser, which is not available in this conversation.");
      if (!(await page.enabled())) throw new MediaProviderError("Turn on Settings → Tools → Browser to generate with a Gemini account.");

      await page.open(GEMINI_APP_URL);
      const probe = (await page.evaluate(PROBE)) as Probe;
      if (probe.composer !== true) {
        throw new MediaProviderError(probe.signedIn === true
          ? "Gemini's prompt box was not found; the app's layout may have changed."
          : `Sign in to Gemini in HUI's browser once (${String(probe.url ?? GEMINI_APP_URL)}), then ask again.`);
      }
      const asked = (await page.evaluate(ask(input.prompt))) as { submitted?: unknown; reason?: unknown };
      if (asked.submitted !== true) {
        throw new MediaProviderError(`Gemini did not accept the prompt (${String(asked.reason ?? "unknown reason")}).`);
      }

      const deadline = Date.now() + timeout;
      let last: Answer = {};
      let found: { src: string; width: number; height: number } | undefined;
      while (Date.now() < deadline) {
        await sleep(interval);
        last = (await page.evaluate(ANSWER)) as Answer;
        const images = imageList(last);
        if (images.length) { found = images[0]; break; }
        if (last.generating !== true && typeof last.text === "string" && last.text.trim()) {
          // The app finished without an image: a refusal, a text answer, or a model without image output.
          throw new MediaProviderError(`Gemini answered without an image: ${last.text.trim().slice(0, 240)}`);
        }
      }
      if (!found) throw new MediaProviderError(`Gemini did not produce an image within ${Math.round(timeout / 1000)} seconds.`);

      const read = (await page.evaluate(readImage(found.src))) as Read;
      if (read.ok !== true || typeof read.data !== "string") {
        throw new MediaProviderError(`Gemini's image could not be read back (${String(read.reason ?? "unknown reason")}).`);
      }
      const mimeType = typeof read.mimeType === "string" ? read.mimeType : "image/png";
      return {
        bytes: Buffer.from(read.data, "base64"),
        mimeType,
        extension: mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png",
      };
    },
  };
}
