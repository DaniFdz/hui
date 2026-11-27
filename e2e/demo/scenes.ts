/** The demo clips, in overview order. Prompts match the scripted model in provider.ts. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { chiefsScene } from "./chiefs-scene.ts";
import type { Director, Target } from "./record.ts";

/** `providerUrl`: the scripted model's server, which also serves the demo's pages and the Datadog graph. */
export type SceneContext = { director: Director; api: (method: string, path: string, body?: unknown) => Promise<Record<string, any>>; providerUrl: string };
export type Scene = {
  name: string;
  /** The chapter tag under the window. */
  chapter: string;
  /** HUI path the clip opens on, and text that shows it is ready. */
  path?: string;
  ready?: Target;
  /** CSS size of HUI's window; smaller shows larger text. */
  viewport?: [number, number];
  /** On a phone: 390×844 in a phone frame, with touch input. */
  device?: "phone";
  /** Opens VS Code, which needs --accept-vscode-license. */
  vscode?: boolean;
  /** localStorage entries HUI loads with, such as view preferences. */
  storage?: Record<string, string>;
  /** What the narrator says, by key: `director.say(key)` speaks a line during the clip (with --voice). */
  narration?: Record<string, string>;
  /** Runs before recording starts. */
  setup?: (context: SceneContext) => Promise<void>;
  run: (context: SceneContext) => Promise<void>;
};

/** Acme's "Trial signups per minute" over the past hour, drawn the way a Datadog snapshot looks (a 1724×740 PNG, as
 * base64). It runs on the stage, whose Chrome draws the SVG; the scripted model's server then serves it as the
 * widget's graph, through the fake pup's snapshot. */
function drawSignupGraph(now: number): Promise<string> {
  const width = 1724, height = 740, left = 120, right = 1690, top = 40, bottom = 630, max = 40, minute = 60_000;
  const start = now - 60 * minute;
  // Steady trials, a dip while double submits failed, the fix's deploy, and the recovery.
  const values = Array.from({ length: 61 }, (_, i) => {
    const wave = Math.sin(i * 1.7) * 2.2 + Math.sin(i * 0.43) * 1.6;
    if (i < 18) return 26 + wave;
    if (i < 22) return 26 - (i - 17) * 4 + wave;
    if (i < 38) return 9 + wave * 0.6;
    if (i < 42) return 9 + (i - 37) * 4.5 + wave;
    return 28 + wave;
  });
  const x = (i: number) => left + (i / 60) * (right - left);
  const y = (value: number) => bottom - (value / max) * (bottom - top);
  const line = values.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const grid = [0, 10, 20, 30, 40].map((value) => `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="${value ? "#e3e6ea" : "#5c6370"}" stroke-width="${value ? 2 : 3}"/><text x="${left - 22}" y="${y(value) + 12}" text-anchor="end">${value}</text>`).join("");
  const ticks: string[] = [];
  for (let t = Math.ceil(start / (15 * minute)) * 15 * minute; t <= now; t += 15 * minute) {
    const at = x((t - start) / minute);
    const label = new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    ticks.push(`<line x1="${at}" x2="${at}" y1="${bottom}" y2="${bottom + 16}" stroke="#5c6370" stroke-width="3"/><text x="${at}" y="${bottom + 62}" text-anchor="middle">${label}</text>`);
  }
  const font = "font-family=\"-apple-system, 'Helvetica Neue', Arial, sans-serif\"";
  const deploy = x(38);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#fff"/>
    <g ${font} font-size="36" fill="#3c4250">${grid}${ticks.join("")}</g>
    <text ${font} font-size="30" fill="#8a909c" transform="translate(34 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle">Trials / min</text>
    <polygon points="${x(0)},${bottom} ${line} ${x(60)},${bottom}" fill="#7d4ccf" fill-opacity="0.12"/>
    <polyline points="${line}" fill="none" stroke="#7d4ccf" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${deploy}" x2="${deploy}" y1="${top}" y2="${bottom}" stroke="#e8973d" stroke-width="4" stroke-dasharray="14 10"/>
    <text ${font} font-size="32" fill="#e8973d" x="${deploy + 16}" y="${top + 34}">deploy #482</text>
  </svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return image.decode().then(() => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
}

let pagesHook = "";
/** The storefront group's Chief of Staff, made in the bots scene's setup: the bot whose started sessions the clip shows. */
let storefrontChief = { id: "", name: "", handle: "" };
/** The Attachments clip's fixtures: a folder of its own under the system's temporary directory, made in `setup`. */
let attachmentDir = "";
let notesFile = "";
let photoFile = "";
/** The clip's picture, 448×252: a sunset drawn once with ffmpeg (a four-stop gradient sky, a sun disc and two hills) and
 * kept as its bytes, so the clip needs no dependency and no picture in the tree. A dot of a picture reads as a broken
 * image in a message bubble, so this one is wide enough for the message's own thumbnail to show what it is. */
const SUNSET_PNG = "iVBORw0KGgoAAAANSUhEUgAAAcAAAAD8CAIAAABviONGAAAACXBIWXMAAAABAAAAAQBPJcTWAAALfElEQVR4nO3dd5BdVR3AcV5m7YWaAMIgo+M4I/+gggWwgWJBQUyy1PTe6RN6IIGEIi0hCekJpJCCZdRRRuzYpTg6o+MIiCCQhGLvo8tsePvYLMnu2XPvueXz+YO575Hs+/3zvjnn3rf3NQ5725g9AOi7tkbqCQBKSkABArU1FBQgiBUoQCABBQjUsYWXUIAQVqAAgQQUIJCr8ACBrEABAnUEVEIBQtjCAwSyhQcIJKAAgWzhAQK5iAQQyBYeIFDbAAUFCGIFChDIRSSAQC4iAQSyhQcIZAsPEMgKFCCQgAIE8p1IAIGsQAECCShAIFfhAQJZgQIE8ptIAIFs4QEC2cIDBBJQgEBuqAwQyEUkgEAuIgEEcg4UIJCAAgSyhQcI5CISQCBbeIBAtvAAgaxAAQIJKEAg34kEEMgKFCCQgAIEchUeIJAVKEAgv4kEEMgNlQEC2cIDBHIRCSCQFShAIBeRAALZwgMEsoUHCCSgAIFs4QECuYgEEMgWHiCQLTxAICtQgEACChDIdyIBBLICBQgkoACB3FAZIJAVKEAgF5EAAlmBAgQSUIBAfpUTIJAVKEAgt7MDCGQLDxDIFh4gkIACBLKFBwjkIhJAIFt4gEC28ACBrEABAgkoQKC2AfbwAEGsQAECuYgEEMgKFCCQgAIEsoUHCCSgAIE6tvD/Sz0DQCm1DbAChcycteH03v/hm05dl90kZKFjC28FCjHNWH9G2F9sre3Np62NNA4Zcg4U4pi+LrCbPWpW+JbTlbS4rEChX6atPTPTn9/s8vwz7sj0hQjgHCgEmnJHtunsprPUt54powViBQp9Nvn2YaleurPaC4fdnmoAWvlNJOiDSenS2aqj4Is0tACsQKG3Jq4ZnnqELp0pXzx8TepBaq1x2+AZqWeAEhi/ukD1bLVkhIYm01gyZHrqGaDQxq0akXqE3Vs6cnXqEeqosXTotNQzQHGNXTky9Qi9tWzUqtQj1E5jWbuAQs/GrBiZeoS+WT56VeoR6qWxvH1q6hmgiEavGJV6hBArRq9MPUKNNFaeIqDQ3cjlpaxnp1VjNDQnjVWnTkk9AxTLiGWjU4/QX6vHrkg9Qi00Vp8moNBl+NLS17PTmnEamjkfpIcuw5aMST1CNN7aOXAzEaimjn8M1k5YnnqKimusPXNS6hmgEE5fPDb1CPGtm7gs9QhV1lgnoLDHHqdVsZ6d1mtoZpwDhYrzHs9O487hE1PPAIm1LxyXeoRsbZy8NPUI1WQFCtXnbZ6RxqaRE1LPACkNWTA+9Qh52Dx1SeoRKsgKFGrBOz0LjbtG1eKfX+jRyfNrtAP73LTbUo9QNVagUBfe7NE1Pj+msh9/g1076ebafQj6CzMWpR6hUjpWoKlHAPLi/R5X2wCreqgN7/e4Gl8aX53bz0DvnXDD5NQjpPHlcxamHqE6XESCevGWj6jNKRGoFW/5iJwDhXrxlo+o8bVJJf7yLAhz/HW1/i7Fu89fkHqEimi75sE9mw9mHv5cwlGAfDgNGktb64N5D+zVeXDh25UUKsunQWNp6/HZuffvKOnF73g2x2GAPDgNGkvPAW266r69m8eXiClUggVoLLsJaKs5L8T00nc+k80wQB6cA42lDwFtmv2zfToPLjtCSaF8nAONJSSgTVf+dJ/m8awjn+73MEAenAONpV8BbTXrJ/t2HlzxLiWl0I6Zc1bqERKzAo0lWkCbLv/xvs3jK9+9PfrPh36699Ibj559duopUnIONJb4AW112Y/26zyY/Z5tmb4Q0HsCGku2AW269IcDm8dXiSkkNSD1AJWRU0BbXfxCTK9+79b8Xx2wAo0lQUCbLvrBoObx3KPEFHLiIlIsKQPa6sLv74jpvKOfSjsJVJ4VaCxFCWjTzHv3bx5fe4yYQnwDrEAjKVxAW13wva6YXve+JxNOAlViBRpLoQPa6vzvHtB5cL2SQj/cP/s6C9BYShPQpvNeKGmHz77/iYSTUF4PzLn28EsuSD1FGpafEZUvoK3O/c6BzeMbPiCmsHsuwUdU7oC2OufbXTG96YN/SDgJFJk7iURUnYC2Outbb2ge3/whMYUdfjH3GivQiKoZ0FYzvtkV01uOfTzhJBTKL+fNO2zmzNRT5M0J0LiqH9BW079xUPN4/nFiSu1YfsZVr4C2mnZPV0xvPe6xhJNAPn51zVy3EYmrvgFtNeWeg1sfLvywntbCr6+d+9YLLkw9RX4sP6MT0B5M/npXTxd95PcJJ4GInACNrnHsUXX/eoM+WXz8o6lHILK3nHdx6hHy8Jvrr0o9QgVZgfbNxLsPaX245KN6Sjm4gUgWrEBjWvqx36UegRBvOueS1CNk66Eb5qQeoZqsQGMa99U3tj5cpqcUwMM3zLH6zIiAZmjsi3u6/OOPJBqE3XjkxtmHnn1p6imy4tpRdmzhU1r5iUdSj0CXQ86qYEMfvWl26hGqzAo0pVFfObTbM6tOeDjFIFSW5WemrECLbvUnJTU/B0+/LPUIMT12y5WpR6g4AS2lNZ96KPUIlXXQtMtTjxDH4/OvSD1C9QloddxxoqrGceDU0jf0iQXqmQcBrb61J/429Qjlc8DUWalHCPfkglmpR6gLF5Gq74wvvrnH59edJKwV9NSts9w0JDdWoPRg/ae1dY9Bk2elHqHPti6clXqEehFQ+mz9yTU62TpoUmnOh25d5Lxn3gSU+NZ/plIfvRo0sQSfbdq62CeWEhBQ0lg/+JHUI/TBoAmF/iWlrbf5daM0BJRCWz+kKDdkGTS+oHds2rrEnZaSEVCqYMPQnG7MOnBcge6+vG2peyQnJqDUy4b2/n5Hy8CxF0WZpJ+2Lbs69QgIKOxkwym7/1bBgWOSfRvdtuVzU7003fggPXR36p0H7/bPbGjM6/jvwNEzsx+ny7YVz7+ob9csDitQiO+eu4fF/YHbV1wT9wcShRUoxHfc8bfv4v/2Pq/bV16748iqs5AEFPK2i7x2tnX7qut2PNbNYrOFhxK484ynUo9AD6xAoQROWbv/zk/eeebW/CehlYBCWZ1yx6Cdn9w4bFv+k9SWgEKltN8+cOcnNw7fnv8kdSCgUH3ta/br9szGEU8nmaRiBBTqqH31vt2e2TjymSSTlJqAAs9rX7VPt2c2jno2ySQlIqBAz9pX7t36cNPo51JNUlgCCvTK0BV7tT7cNOaPqSYpDgEFQgxdvmfrw01j/pRqkoQEFIhg6PLXtz7cNLYWPRVQIL6hy7p6umncnxNOkikBBbI1dOnrWh9uHv+XVJNEJ6BAroYseW3zePOEvyacpP8EFEhmyG2vaR5vnvi3hJOEEVCgEIYsfnXzePOkvyecpPcEFCicIYte1fpwy+R/pJpk1wQUKLrBC1/ZebBlyj/TTtKNgAKlMfjWVzSPt0z9V8JJOgkoUEqDF7y8ebxl2r+TzCCgQOkNnv+y5vGW6f/p/w888ryf9+aPCShQKYNv6craXTP+23lwxLkPZvFaAgqUwKOP3hfwt444N/ogLyKgQObC8ld8AgrsRlXz138CCnWhg9EJKJSVICYnoFA4ylgWAgp508fKEFCITyJrQkAhkEoioLArKskuCCjsoJX0lYBSR1pJFAJKxWkl2RFQqkMryZmAUlZySXICSjnIJQUkoBSRXFIKAkohKCZlJKAkIJdUg4CSB8WkkgSUTCgmdSCgxKGY1JCAEkgxQUDpLcWEbgSUl6SYsGsCShfFhD4R0LoTTQgmoLWjmBCLgFafYkJGBLSaRBNyIKAVoZiQPwEtMdGEtAS0TBQTCkVAC00xocgEtHBEE8pCQNNTTCgpAU1DNKECBDQnignVI6BZUUyoPAGNRjGhbgS0X0QT6kxA+0YxgSYB3Q3FBF6KgHanmEAv1T2gcgkEq11AFROIpfoBVUwgI1ULqFwCuSl3QOUSSKhMAZVLoFCKG1C5BAru//VSQH6MheOBAAAAAElFTkSuQmCC";
const soul = (who: string) => `# Who I am\n${who} Short answers, always with the next step.\n`;
const card = (title: string, column?: string): Target => ({ css: `${column ? `.kanban-cell--${column} ` : ""}.kanban-card__title`, text: title });
const link = (text: string): Target => ({ css: "a", text });

/** Brings a chat element to the middle of the view once it is there, as a reader scrolls to it before looking. */
async function centre(d: Director, target: Target) {
  await d.waitFor(target);
  await d.stage("window.found?.scrollIntoView({ block: 'center', behavior: 'smooth' })");
  await d.pause(800);
}

/** Parks the cursor on the header line: a transcript that scrolls under a still cursor slides links beneath it, and a
 * link's hover card then covers the picture the line is about. */
async function parkCursor(d: Director) {
  await d.move({ x: 620, y: 18 });
}

/** Scrolls a page to an element it has not brought into view yet: a long page, such as Usage, keeps its cards below the
 * fold, where the recorder cannot point at them. The stage shares HUI's origin, so it scrolls HUI's own page. */
async function reveal(d: Director, selector: string) {
  const found = await d.stage<boolean>(`(() => {
    const page = document.getElementById("app").contentDocument.querySelector(${JSON.stringify(selector)});
    page?.scrollIntoView({ block: "center" });
    return Boolean(page);
  })()`);
  if (!found) throw new Error(`The page has no ${selector}`);
  await d.pause(700);
}

/** Waits until a target has left the screen: the view removes the working row when a run settles, so its absence is the
 * only signal that nothing more is streaming into the row a line is about to describe. */async function gone(d: Director, target: Target, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (await d.find(target)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${JSON.stringify(target)} to go`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

/** Waits for the screen to catch up with the DOM. The stage and HUI share a renderer, so a streamed row can be whole
 * where `find` reads it while the compositor still shows the half-drawn one; a capture makes the renderer draw the
 * settled state, which is the picture the cut then lands on. */
async function caughtUp(d: Director) {
  await d.send("Page.captureScreenshot", { format: "jpeg", quality: 20 });
}

/** Waits until the camera has finished moving, so a cut can end on the frame it framed: the stage's zoom runs 700 ms,
 * and the frames before it lands still hold what the move was leaving behind. */
async function cameraRested(d: Director) {
  await d.stage(`(() => {
    const camera = document.getElementById("camera");
    void getComputedStyle(camera).transform;
    return Promise.all(camera.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  })()`);
  await d.stage(`new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 80))))`);
}

/** Sends a follow-up once the session is idle, whose composer reads "Send a message…" (a busy one names the steer and queue shortcuts). */
async function send(d: Director, prompt: string) {
  await d.click({ placeholder: "Send a message…" });
  await d.type(prompt);
  await d.pause(300);
  await d.press("Enter");
  // Sometimes the chat stops following the bottom (seen after a widget); a user would tap "Scroll to latest".
  await d.pause(600);
  if (await d.find({ css: ".chat-scroll-to-bottom[data-visible='true']" })) await d.click({ label: "Scroll to latest" });
}

/** Sets a caption exactly when its line begins: the previous line ends, the caption lands, then this line starts. Without
 * this, a caption set before `say` waits for the last line changes up to a line and a half before its own voice. */
async function narrate(d: Director, caption: string, key: string) {
  await d.quiet();
  await d.caption(caption);
  await d.say(key);
}

/** Parks the cursor over the window's chrome, off the page: a hover there leaves the content, so no tooltip is left over
 * the beat being filmed. */
async function park(d: Director) {
  await d.move({ x: -40, y: -20 });
  await d.pause(400);
}

/** Opens the chat's Run status panel when the run left it shut. The trigger keeps its box as the panel's anchor, so the
 * collapse control is what tells whether the panel is out. */
async function openRunStatus(d: Director) {
  await d.waitFor({ css: ".chat-run-status__trigger" }, 30_000);
  if (!(await d.find({ css: ".chat-run-status__collapse" }))) await d.click({ css: ".chat-run-status__trigger" });
  await d.waitFor({ css: ".chat-run-status__panel" }, 10_000);
}

/** Closes the Run status panel: a card in the transcript behind it would lose its right side. */
async function closeRunStatus(d: Director) {
  if (!(await d.find({ css: ".chat-run-status__collapse" }))) return;
  await d.click({ css: ".chat-run-status__collapse" });
  await d.waitFor({ css: ".chat-run-status__trigger[aria-expanded='false']" }, 10_000);
  await d.pause(400);
}

/** Opens a finished batch's folded helper rows, so their names and states are on screen. */
async function unfoldHelpers(d: Director) {
  if (await d.find({ css: ".chat-run-status__success:not([open]) > summary" })) {
    await d.click({ css: ".chat-run-status__success:not([open]) > summary" });
    await d.pause(300);
  }
}

/** Dismisses HUI's operation toast when it is up: its message would otherwise sit over the content the beat shows. */
async function dismissNote(d: Director, text: string) {
  if (!(await d.find({ css: ".app-toast.chat-operation-toast", contains: text }))) return;
  await d.click({ css: ".app-toast.chat-operation-toast .app-toast__dismiss" });
  await d.pause(300);
}

/** What the browser pane shows around a handoff, in the app's own pixels: its strip, its Continue button, the element
 * on top of that button and the activity line. A release that did not happen is read from here, not guessed. */
async function handoffState(d: Director) {
  return d.stage<{ panes: number; strip: { x: number; y: number; width: number; height: number } | null; done: { x: number; y: number; width: number; height: number } | null; top: string | null; activity: string; camera: string }>(`(() => {
    const doc = document.getElementById("app").contentDocument;
    // HUI's elements draw into the light DOM, so the pane and its strip are plain descendants: the panes are found the
    // way the recorder finds its targets, then queried directly.
    const panes = [];
    const walk = (root) => {
      for (const element of root.querySelectorAll("*")) {
        if (element.tagName === "HUI-BROWSER-PANE") panes.push(element);
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(doc);
    const pane = panes.find((element) => element.querySelector(".hui-browser-activity"));
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const strip = box(pane?.querySelector(".hui-browser-handoff"));
    const done = box(pane?.querySelector(".hui-browser-handoff__done"));
    const hit = done ? pane.ownerDocument.elementFromPoint(done.x + done.width / 2, done.y + done.height / 2) : null;
    return {
      panes: panes.length, strip, done,
      top: hit ? [hit.tagName.toLowerCase(), ...[...hit.classList].map((name) => "." + name)].join("") : null,
      activity: pane?.querySelector(".hui-browser-activity__text")?.textContent?.trim() ?? "",
      camera: getComputedStyle(document.getElementById("camera")).transform,
    };
  })()`);
}

/** Brings an element in the transcript to the middle of the view. The chat follows its last row, so a scripted smooth
 * scroll from the bottom is re-pinned before it leaves HUI's bottom zone; a run of small scrolls is what a reader does. */
async function centreInThread(d: Director, target: Target) {
  await d.waitFor(target);
  const deadline = Date.now() + 20_000;
  let previous = Number.NaN;
  for (;;) {
    const box = await d.find(target);
    if (!box) throw new Error("The element to centre is no longer in the transcript.");
    const offset = box.y + box.height / 2 - 300;
    if (Math.abs(offset) < 40) return;
    const top = await d.stage<number>(`document.getElementById("app").contentDocument?.querySelector(".chat-thread")?.scrollTop ?? -1`);
    // The scroll stopped moving: the element sits where the transcript's edges put it.
    if (top === previous) return;
    previous = top;
    await d.stage(`document.getElementById("app").contentDocument?.querySelector(".chat-thread")?.scrollBy(0, ${Math.round(offset / 2)})`);
    await d.pause(150);
    if (Date.now() > deadline) throw new Error("The transcript did not reach the element to centre.");
  }
}

/** The draft the Rich chat clip types: bold, a bullet list and inline code, and the canonical Markdown (a paragraph,
 * a blank line, then the bullets) the serializer puts on the wire. */
const RICH_DRAFT = "Chart this week's build times from the `ci` export\n\n- **main** and pull requests\n- Wednesday's cache change landed";

/** A composer's hidden Markdown wire, which no box makes a target reachable: the stage reads the field itself. */
async function composerWire(d: Director, name: "text" | "prompt"): Promise<string> {
  return d.stage<string>(`document.getElementById("app").contentDocument?.querySelector('input[data-testid="composer-markdown"][name="${name}"]')?.value ?? ""`);
}

/** One element's words, flattened: a count, a lane's name or a badge's number, which no box makes a target that reads
 * its text rather than its place on screen. */
async function textOf(d: Director, selector: string): Promise<string> {
  return d.stage<string>(`(document.getElementById("app").contentDocument?.querySelector(${JSON.stringify(selector)})?.textContent ?? "").replace(/\\s+/g, " ").trim()`);
}

/** Every matching element's words, in the page's own order. */
async function textsOf(d: Director, selector: string): Promise<string[]> {
  return d.stage<string[]>(`(() => [...document.getElementById("app").contentDocument?.querySelectorAll(${JSON.stringify(selector)}) ?? []]
    .map((element) => (element.textContent ?? "").replace(/\\s+/g, " ").trim()))()`);
}

/** Waits until every image a selector matches has decoded and none of their figures is marked failed: a failed load keeps
 * the `img` and its `alt` in the DOM and swaps in a fallback card, so an element naming the picture proves nothing. The
 * bitmap must be `complete` with a width, which is what the drawn picture has and the fallback's broken one does not. */
async function decodedImage(d: Director, selector: string, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const images = await d.stage<{ failed: boolean; complete: boolean; width: number }[]>(`(() =>
      [...document.getElementById("app").contentDocument.querySelectorAll(${JSON.stringify(selector)})].map((img) => ({
        failed: Boolean(img.closest("[data-failed]")), complete: img.complete === true, width: img.naturalWidth })))()`);
    if (images.some((image) => image.failed)) throw new Error(`${selector} failed to load: its figure is marked data-failed.`);
    if (images.length && images.every((image) => image.complete && image.width > 0)) return;
    if (Date.now() > deadline) throw new Error(`${selector} never drew a decoded image: ${JSON.stringify(images)}`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

/** Waits until one element reads exactly `expected`: a queue's counts settle in the order its turns finish, never all at
 * once, so the picture is framed on the state the beat names. */
async function readsAs(d: Director, selector: string, expected: string, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await textOf(d, selector) === expected) return;
    if (Date.now() > deadline) throw new Error(`${selector} never read ${JSON.stringify(expected)}; it reads ${JSON.stringify(await textOf(d, selector))}.`);
    await new Promise((done) => setTimeout(done, 200));
  }
}

/**
 * A bot's own work (#582), filmed after the Bots clip's handoff beat: the nine sessions the bot starts in one scripted
 * turn, plus the two sessions it started earlier in the clip, so the queue holds eleven rows. One of the nine asks the
 * operator a question and one is still running, so the queue's lanes are all three. The panel's Work section draws the
 * headline, the lanes and eight rows with the rest behind `Show 3 more`, and the roster row counts what is in flight
 * beside its name. The counts are read off the page, never assumed: the queue settles in the order the sessions finish,
 * and the scene waits for the state the caption names.
 */
async function botWorkQueue(d: Director) {
  const panel = '[aria-label$="bot panel"]';
  const work = "section[aria-labelledby$='overview-work']";
  /** The prompt that starts the nine: one brief each, and the queues' answer after them. */
  const ask = "Queue this week's storefront chores and check the refund copy with me";
  await d.cut(async () => {
    // A bot's panel docks beside its own chat: the roster row opens both. The camera comes back to the wide page first,
    // or the tab is outside the stage the click lands on.
    await d.zoom();
    await d.click({ css: "#sidebar-tab-bots" });
    await d.click({ css: ".bot-row__name", text: storefrontChief.name });
    await d.waitFor({ css: ".ProseMirror[aria-label='Message']" }, 60_000);
    if (!(await d.find({ css: panel })) && (await d.find({ label: "Show the bot panel" }))) await d.click({ label: "Show the bot panel" });
    await d.waitFor({ css: panel }, 20_000);
    // A panel left on one of its pages keeps that page: walk back to the overview the Work section lives on.
    if (await d.find({ css: "button[aria-label^='Back to ']" })) await d.click({ css: "button[aria-label^='Back to ']" });
    await d.waitFor({ css: `${panel}[data-view='overview']` }, 20_000);
    // Nine sessions take a while to start one at a time; the cut is what the viewer does not sit through.
    await send(d, ask);
    await d.waitFor({ contains: "Nine sessions are up" }, 300_000);
    // The counts are the queue's settled state: one question waiting, one turn still running, the rest finished.
    await readsAs(d, ".bot-overview__counts", "1 needs you · 1 working · 9 recent");
    await scrollIn(d, work);
    // A tooltip the pointer left open over the chat would sit in the beat's frame; the cursor parks off the page.
    await park(d);
    await caughtUp(d);
  });
  const lanes = await textsOf(d, ".bot-work__lane-label");
  if (lanes.join("|") !== "Needs you|Working|Recent") throw new Error(`The Work section draws the lanes ${JSON.stringify(lanes)}.`);
  const rows = () => textsOf(d, ".bot-work__link");
  if ((await rows()).length !== 8) throw new Error(`The capped queue drew ${(await rows()).length} rows, not the cap's eight.`);
  const more = await textOf(d, "button.bot-work__more");
  if (more !== "Show 3 more") throw new Error(`The queue's toggle reads ${JSON.stringify(more)}, not the three rows behind it.`);
  await d.zoom({ css: work }, 1.2);
  await cameraRested(d);
  await d.caption("Needs you, working, recent");
  await d.pause(3_000);
  await d.zoom();
  // The cap: eight rows and the rest behind one toggle, in place, without leaving the bot.
  await d.click({ css: "button.bot-work__more" });
  await d.waitFor({ css: "button.bot-work__more[aria-expanded='true']" }, 10_000);
  if ((await rows()).length !== 11) throw new Error(`Show more drew ${(await rows()).length} rows, not eleven.`);
  await d.caption("Eight rows, then the rest");
  await d.pause(3_000);
  // The roster's badge counts what the bot has in flight, at the bot's own row in the sidebar.
  await d.zoom();
  await d.pause(400);
  await d.click({ css: "#sidebar-tab-bots" });
  await scrollIn(d, 'span.bot-row__inflight[data-testid="bot-row-inflight"]');
  const badge = await d.waitFor({ css: 'span.bot-row__inflight[data-testid="bot-row-inflight"]' }, 10_000);
  const flights = await textOf(d, 'span.bot-row__inflight[data-testid="bot-row-inflight"]');
  const row = await d.stage<string>(`(() => [...document.getElementById("app").contentDocument.querySelectorAll("a.bot-row__link")]
    .find((link) => (link.getAttribute("aria-label") ?? "").startsWith(${JSON.stringify(storefrontChief.name)}))?.getAttribute("aria-label") ?? "")()`);
  if (flights !== "2") throw new Error(`The roster badge reads ${JSON.stringify(flights)}, not the two sessions in flight.`);
  if (!row.includes(`${flights} sessions in flight`)) throw new Error(`The roster row's name does not carry its sessions in flight: ${JSON.stringify(row)}`);
  await d.zoom({ x: badge.x + badge.width / 2, y: badge.y + badge.height / 2 }, 1.8);
  await cameraRested(d);
  await d.caption("Two in flight, on the row");
  await d.pause(3_000);
}

/** Scrolls an element the clip is about to use into view: a sidebar or a panel list is longer than the window, and a
 * target off it is not visible to `find`. */
async function scrollIn(d: Director, selector: string, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const drawn = await d.stage<boolean>(`(() => {
      const element = document.getElementById("app").contentDocument?.querySelector(${JSON.stringify(selector)});
      element?.scrollIntoView({ block: "center" });
      return Boolean(element);
    })()`);
    if (drawn) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${selector} to be drawn.`);
    await new Promise((done) => setTimeout(done, 200));
  }
}

/** The checkout page's Confirm button, in the page's own 390×844 pixels: the pane shows the page's image, so a tap at
 * the same fraction of the frame is the same point on the page. */
const CHECKOUT = { width: 390, height: 844, x: 195, y: 598 };

/** The composer's selection strip's twelve buttons, in the order the toolbar draws them (`lib/composer/rich/toolbar.ts`). */
const TOOLBAR_BUTTONS = ["Bold", "Italic", "Strikethrough", "Inline code", "Quote", "Note", "Bullet list", "Code block", "Text", "Cut", "Copy", "Paste"];

/**
 * The rich composer's own blocks and its selection strip (#578, #580), typed after the Rich chat clip's Datadog beat: a
 * fence opens on Enter with the language it named, a note opens on its own marker, and a secondary click over the whole
 * selection opens the twelve-button toolbar whose Quote moves the draft into a quote in one step and one undo. Every
 * promise is read from the hidden Markdown wire the form submits — the fence's opener, the note's `> [!NOTE]` marker and
 * the quote's `> ` — so the clip shows what the feature writes, not what the editor happens to draw. `RICH_DRAFT` and the
 * check that holds it stay exactly as they were.
 */
async function composerBlocks(d: Director) {
  const editor = { css: ".ProseMirror[aria-label='Message']" };
  const wire = () => composerWire(d, "text");
  const line = "const total = formatTotal(order.total, order.currency);";
  const note = "Rollback is one click on the release page.";
  const sentence = "Ship it once the checks pass.";
  // Typing aims at the editor itself: a box the scene searched for inside it is not a field, and the search must not
  // leave the caret anywhere else. One helper keeps every line going into the draft the caret's own.
  const type = async (text: string) => { await d.find(editor); await d.type(text); };
  /** The draft's Markdown, held to the words this beat promises; never the whole string, which `RICH_DRAFT` owns. */
  const carries = async (what: string, markers: string[]) => {
    const draft = await wire();
    for (const marker of markers) {
      if (!draft.includes(marker)) throw new Error(`The draft after ${what} does not carry ${JSON.stringify(marker)}: ${JSON.stringify(draft)}`);
    }
    return draft;
  };
  await d.zoom();
  await caughtUp(d);
  await d.click({ placeholder: "Send a message…" });
  await d.caption("A fence opens on Enter");
  await d.pause(1_000);
  // ```ts and Enter open the block with the language it named instead of sending the draft; the closing line is never
  // typed. An empty `code` is an inline box of no width, so the language is read off the element rather than searched for.
  await type("```ts");
  await d.press("Enter");
  await d.waitFor({ css: ".ProseMirror pre" }, 10_000);
  const language = await d.stage<string>(`document.getElementById("app").contentDocument.querySelector(".ProseMirror pre > code")?.getAttribute("class") ?? ""`);
  if (language !== "language-ts") throw new Error(`The fence opened without its language: ${JSON.stringify(language)}`);
  await type(line);
  // Enter twice leaves an empty line inside the fence; Backspace takes it back and puts the caret in the paragraph after.
  await d.press("Enter");
  await d.press("Enter");
  await d.press("Backspace");
  await d.waitFor({ css: ".ProseMirror p" }, 5_000);
  await carries("leaving the fence", ["```ts", line]);
  await d.pause(1_500);
  // A quote opens on `> ` and its marker turns into the note on Enter, the marker typed once and gone from the draft. The
  // space is its own stroke: the rule that converts `> ` takes the characters off the draft, so the text a typed word is
  // checked against would be the one the conversion left, not the one the keystroke wrote.
  await type(">");
  await d.press("space");
  await type("[!NOTE]");
  await d.press("Enter");
  await d.waitFor({ css: '.ProseMirror aside.markdown-alert--note[aria-label="Note"]' }, 10_000);
  await type(note);
  await d.zoom(editor, 1.25);
  await d.pause(1_500);
  await carries("the note", ["> [!NOTE]", `> ${note}`]);
  await d.caption("A block, and a note");
  await d.pause(3_000);
  // Enter, Enter and Backspace leave the note for a plain paragraph below it: the sentence lands outside the callout.
  await d.press("Enter");
  await d.press("Enter");
  await d.press("Backspace");
  await type(sentence);
  const draft = await carries("the sentence", ["```ts", line, "> [!NOTE]", `> ${note}`, `\n\n${sentence}`]);

  // The selection toolbar: Control+A selects the whole draft, and a secondary click over the words opens the strip.
  await d.press("Control+A");
  const block = await d.find({ css: ".ProseMirror pre" });
  if (!block) throw new Error("The draft's fence is not on screen to open the strip over.");
  await d.contextMenu({ x: block.x + 40, y: block.y + block.height / 2 });
  const strip = await d.waitFor({ css: "div.composer-toolbar[role='toolbar'][aria-label='Format selection']" }, 10_000);
  const buttons = await d.stage<string[]>(`(() => [...document.getElementById("app").contentDocument
    .querySelectorAll("div.composer-toolbar[role='toolbar'] button")]
    .map((button) => button.getAttribute("aria-label") ?? ""))()`);
  if (buttons.join("|") !== TOOLBAR_BUTTONS.join("|")) throw new Error(`The strip draws ${JSON.stringify(buttons)}, not ${JSON.stringify(TOOLBAR_BUTTONS)}.`);
  await d.caption("Twelve formats, one strip");
  await d.zoom({ x: strip.x + strip.width / 2, y: strip.y + strip.height / 2 }, 1.7);
  await d.pause(3_000);
  // Quote moves the selected draft into a quote: one action, one undo, and the markers the wire already carried stay.
  await d.click({ label: "Quote" });
  const quoted = await wire();
  if (!quoted.startsWith("> ")) throw new Error(`The quote action wrote no quote prefix: ${JSON.stringify(quoted)}`);
  for (const marker of ["```ts", line, "> [!NOTE]"]) {
    if (!quoted.includes(marker)) throw new Error(`Quoting the draft lost ${JSON.stringify(marker)}: ${JSON.stringify(quoted)}`);
  }
  // The quoted draft is the beat: the camera comes off the strip so the whole quote is in frame, and it holds long
  // enough to read before the undo returns the draft the clip typed.
  await d.zoom(editor, 1.25);
  await cameraRested(d);
  await d.caption("The selection becomes a quote");
  await d.pause(4_500);
  await d.caption();
  await d.press("Control+Z");
  const undone = await wire();
  if (undone !== draft) throw new Error(`One undo did not put the draft back.\nexpected: ${JSON.stringify(draft)}\nreceived: ${JSON.stringify(undone)}`);
  // Out of the strip, the draft cleared: the clip ends on the wide page with an empty composer.
  await d.press("Escape");
  await d.press("Control+A");
  await d.press("Delete");
  await d.waitFor({ placeholder: "Send a message…" }, 5_000);
  if (await wire() !== "") throw new Error(`The composer still holds a draft: ${JSON.stringify(await wire())}`);
  await d.caption();
  await d.zoom();
}

/** The streamed picture the operator is driving, as the frame it shows: every frame the page paints arrives as a new
 * image, so the source itself is the fingerprint. A hash of it collided for two frames of the same length, and the
 * clip read a painted page as one that never repainted. */
async function framePixels(d: Director): Promise<string> {
  return d.stage<string>(`document.getElementById("app").contentDocument?.querySelector(".hui-browser-frame img")?.getAttribute("src") ?? ""`);
}

/** Waits until the page repaints after the operator's input: the frame is the only view of it this page has. */
async function frameRepainted(d: Director, before: string, timeout = 30_000) {
  if (!before) throw new Error("The pane shows no live page frame, so a tap's repaint cannot be seen.");
  const deadline = Date.now() + timeout;
  while (await framePixels(d) === before) {
    if (Date.now() > deadline) throw new Error("The page did not repaint after the tap.");
    await new Promise((done) => setTimeout(done, 100));
  }
}

export const scenes: Scene[] = [
  {
    name: "kanban",
    chapter: "Kanban",
    path: "/dashboard",
    ready: { contains: "The sessions in flight" },
    storage: { "hui.kanban-options": JSON.stringify({ groupBy: "custom" }) },
    narration: {
      dashboard: "Start on the Dashboard. Every session in flight, what needs you first, and how the machine is doing.",
      board: "The Kanban board puts the same sessions in the stage their work is in.",
      drag: "When the work moves on, drag the card along.",
      backlog: "A backlog item starts its own session, in a fresh Git worktree, with a branch name suggested for you.",
      work: "The agent gets going right away: it reads the code, writes the change, and runs the tests.",
      progress: "And H U I keeps a task progress card for it, so you can see how far along it is without reading the chat.",
      stage: "Agents keep the board up to date themselves. Tell this one that CI passed, and it moves its own card to Testing.",
    },
    async run({ director: d }) {
      await d.caption("One page shows what is in flight");
      await d.say("dashboard");
      await d.move({ css: "[data-testid='dashboard-stats']" });
      await d.zoom({ css: "[data-testid='dashboard-stats']" }, 1.4);
      await d.pause(2_000);
      await d.quiet();
      await d.zoom();
      await d.click(link("Kanban"));
      await d.waitFor({ contains: "Drag a backlog item" });
      await d.caption("Every session is a card, in the stage its work is in");
      await d.say("board");
      await d.move(card("Apple Pay at checkout"));
      await d.pause(1_600);

      // The drag plays at 1.0: under the stage's zoom Chrome draws the dragged card twice, at two scales.
      await d.caption("Drag a card when the work moves on");
      await d.say("drag");
      await d.quiet();
      await d.drag({ css: ".kanban-card", contains: "Search results skeleton" }, { css: ".kanban-cell--done", nth: 0 });
      await d.waitFor(card("Search results skeleton", "done"));
      await d.pause(900);

      // The dialog is the picture "in its own worktree" names, so choosing that option and its suggested branch is the
      // cut: the line starts with the choice made, not with "Current checkout · main" selected under it.
      await d.cut(async () => {
        await d.click(card("Add CSV export to the orders page"));
        await d.waitFor("New worktree");
        await d.zoom({ css: "dialog" }, 1.3);
        await d.click("New worktree");
        await d.waitFor({ contains: "feature/orders-csv-export" });
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Start a backlog item in its own worktree");
      await d.pause(1_200);
      await d.say("backlog");
      await d.quiet();

      // Starting the session, the card it puts on the board and the session it opens are the wait: the line that reads
      // the new session starts on it, framed on its own work instead of a slice of the sidebar.
      const started = card("Add CSV export to the orders page", "investigation");
      const tests = { css: "[data-testid='message-row']", contains: "node --test" };
      await d.cut(async () => {
        await d.click({ css: "button", text: "Start session" });
        await d.zoom();
        await d.waitFor(started, 40_000);
        await d.click(started);
        await d.waitFor(tests, 60_000);
        await centre(d, tests);
        await d.zoom(tests, 1.35);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("The agent gets to work right away");
      await d.say("work");
      await d.pause(1_400);
      await d.quiet();
      await d.zoom();

      // The plan is the Run status panel's now: the pill counts its steps, and the operator opens the panel. Opening it
      // and waiting for the card are a cut, so the line starts with the progress card on screen.
      const progress = { css: "[data-testid='task-progress']" };
      await d.cut(async () => {
        await d.waitFor({ css: ".chat-run-status__trigger" }, 60_000);
        if (!(await d.find({ css: ".chat-run-status__trigger[aria-expanded='true']" }))) await d.click({ css: ".chat-run-status__trigger" });
        await d.waitFor(progress, 20_000);
        await d.pause(600);
        await d.zoom(progress, 1.45);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("HUI keeps a task progress card");
      await d.say("progress");
      await d.pause(2_400);
      await d.quiet();
      await d.zoom();

      // Telling the session that CI passed, the agent moving its card and the board showing it are a cut: the closing
      // line reads the moved card, and the clip ends on the wide board it was moved on.
      const moved = card("Apple Pay at checkout", "testing");
      await d.cut(async () => {
        await d.click(link("Apple Pay at checkout"));
        await send(d, "CI passed on Apple Pay. Move it to review.");
        await d.waitFor({ contains: "moved this card to" }, 30_000);
        await d.click(link("Kanban"));
        await d.waitFor(moved, 30_000);
        await centre(d, moved);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Agents report their own stage");
      await d.say("stage");
      await d.quiet();
      await d.caption();
    },
  },
  {
    name: "integrations",
    chapter: "Rich chat",
    viewport: [1280, 720],
    ready: "Apple Pay at checkout",
    narration: {
      chart: "Start a new session and type the request: the composer writes the Markdown as you go.",
      widget: "And the answer comes back as an interactive widget, on your theme.",
      browser: "It can drive a real browser too. You watch the page live while it fills in the signup form.",
      cards: "Links unfurl into cards, like the merged pull request and the Slack thread behind it.",
      datadog: "Datadog dashboards too: the widget's graph, read through your own orgs, as in Slack.",
    },
    // The widget's graph: drawn on the stage, then served by the scripted model's server as the fake pup's snapshot.
    async setup({ director, providerUrl }) {
      const png = await director.stage<string>(`(${drawSignupGraph.toString()})(${Date.now()})`);
      const response = await fetch(new URL("/demo/datadog-graph.png", providerUrl), { method: "PUT", body: Buffer.from(png, "base64") });
      if (!response.ok) throw new Error(`The Datadog graph upload failed: ${response.status}`);
    },
    async run({ director: d }) {
      // The clip opens on the session it started on, and the New Session click happens on camera: the cut below lands on
      // the ready composer instead of swallowing the loaded app.
      await d.caption("Start a new session");
      await d.say("chart");
      await d.pause(3_000);
      await d.click({ label: "New session in STOREFRONT" });

      // The rich composer, on camera: the draft formats as it is typed, so the typing is a beat of its own rather than
      // a wait the clip cuts.
      await d.cut(async () => {
        await d.waitFor({ css: "#launch-prompt" }, 20_000);
        await d.click({ placeholder: "What should this session work on?" });
        await caughtUp(d);
      });
      await d.caption("Type it, and it formats");
      await d.pause(3_000);
      // A bullet list starts on `- `, bold on the closing `**` and code on the closing backtick. Enter splits the list
      // item, never sends: Enter in prose sends, which is the send below. The dash and the space that completes the list
      // rule are two strokes: typed as one string the rule would not see the run it converts.
      await d.type("-");
      await d.press("space");
      await d.type("Chart this week's build times from the `ci` export");
      await d.press("Enter");
      await d.type("**main** and pull requests");
      await d.press("Enter");
      await d.type("Wednesday's cache change landed");
      // Shift+Tab on the first item lifts it out of the list: the request is the paragraph above its two bullets.
      await d.click({ css: ".ProseMirror li", nth: 0 });
      await d.press("Shift+Tab");
      await d.zoom({ css: ".ProseMirror" }, 1.2);
      // The formatted draft is the proof the feature works: the editor holds a strong run, a list item and a code span,
      // and the wire the form submits carries exactly the Markdown they serialize to.
      for (const selector of ["strong", "li", "code"]) {
        if (!(await d.find({ css: `.ProseMirror ${selector}` }))) throw new Error(`The draft's editor shows no ${selector}.`);
      }
      const wire = await composerWire(d, "prompt");
      if (wire !== RICH_DRAFT) throw new Error(`The composer's wire is not the draft.\nexpected: ${JSON.stringify(RICH_DRAFT)}\nreceived: ${JSON.stringify(wire)}`);
      await d.caption("Bold, a list, inline code");
      await d.pause(3_000);
      // The send's own line holds on the draft, then the sent row is framed for a moment: the transcript follows the
      // running turn, so the row is on screen only right after it lands.
      await d.caption("Send it, and it arrives as Markdown");
      await d.pause(3_000);
      await d.click({ css: ".ProseMirror p", nth: 0 });
      await d.press("Enter");
      await d.waitFor({ css: ".chat-group.user strong" }, 60_000);
      await d.waitFor({ css: ".chat-group.user li" }, 60_000);
      await d.zoom({ css: ".chat-group.user", last: true }, 1.45);
      await d.pause(2_000);
      await d.quiet();

      // The typed request and the drawn widget are the wait: the widget's own line starts once it is on screen, not over
      // an empty card.
      const widget = { css: ".hui-widget-card__frame" };
      await d.cut(async () => {
        await d.zoom();
        await d.waitFor({ contains: "Toggle the series" }, 40_000);
        await d.zoom(widget, 1.3);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("…and an interactive widget");
      await d.say("widget");
      await d.pause(3_000);
      // The widget runs in its own sandboxed frame; its toggle sits at the top left. The caption has had its hold, so it
      // leaves before the pointer starts changing the chart under it.
      await d.caption();
      const frame = await d.waitFor(widget);
      await d.click({ x: frame.x + 130, y: frame.y + 24 });
      await d.pause(1_600);
      await d.click({ x: frame.x + 40, y: frame.y + 24 });
      await d.pause(900);
      await d.quiet();
      await d.zoom();

      // Sending the browser task, the page it drives and the confirmation that it really got there are a cut: the line
      // starts on the live page, filled in. The turn's own tail scrolls the preview out of the transcript, so the cut
      // waits for the run to settle and scrolls the card back before it frames it.
      const preview = { css: ".hui-browser-preview" };
      await d.cut(async () => {
        await send(d, "Check that signup still works on staging");
        // The transcript scrolls under a still cursor: park it off the page, or a link slides beneath it and opens its
        // hover card over the picture.
        await park(d);
        await d.waitFor(preview, 30_000);
        // The page's own confirmation, which the script quotes only when the browser really got there.
        await d.waitFor({ contains: "We sent a link to dana@acme.dev" }, 40_000);
        await gone(d, { css: ".chat-group--working" }, 40_000);
        await centreInThread(d, preview);
        await d.zoom(preview, 1.35);
        await cameraRested(d);
        await caughtUp(d);
      });
      await park(d);
      await d.caption("It drives a real browser");
      await d.say("browser");
      await d.pause(3_200);
      await d.quiet();
      await d.zoom();

      // The cards sit below the fold: scrolling to the pull request and framing it is the cut before the line about them.
      const pull = { css: ".github-embed" };
      await d.cut(async () => {
        await centre(d, pull);
        await d.zoom(pull, 1.35);
        await cameraRested(d);
        await caughtUp(d);
      });
      await park(d);
      await d.caption("Links unfurl into cards");
      await d.say("cards");
      await d.pause(3_000);
      await d.quiet();

      const datadog = { css: ".datadog-embed" };
      await d.cut(async () => {
        await d.zoom();
        // The card lands under the others, once its graph has loaded.
        await centre(d, { css: ".datadog-embed__image" });
        await d.zoom(datadog, 1.3);
        await cameraRested(d);
        await caughtUp(d);
      });
      await park(d);
      await d.caption("Datadog graphs, from your orgs");
      await d.say("datadog");
      await d.pause(3_000);
      await d.quiet();
      await composerBlocks(d);
      // The closing line reads the graph; the camera comes back to the wide page under it, so the clip ends clean.
      await d.zoom();
      await d.caption();
      await d.pause(1_500);
    },
  },
  {
    name: "trail",
    chapter: "Activity trail",
    viewport: [1280, 720],
    // The storefront checkout's seeded conversation: the turn below is a follow-up in a session that is already there.
    path: "/sessions/demo-1",
    ready: "Apple Pay at checkout",
    async run({ director: d }) {
      const summary = { css: "[data-testid='activity-trail']" };
      const label = '[data-testid="activity-trail"] .chat-activity-trail__label';
      const trail = { css: ".chat-activity-trail" };
      await d.caption("One turn, one activity trail");
      await d.click({ placeholder: "Send a message…" });
      await d.type("Tidy the orders export, check the tests and open the pull request");
      await d.press("Enter");
      // While the turn runs the summary is a clock: two readings seconds apart, a second further on in each reading.
      // The summary mounts while the turn is still thinking — when its label reads `Thinking…` — so the clock is what the
      // wait looks for, never the element: the label is read only once it counts.
      await d.waitFor({ css: label, contains: "Working for" }, 60_000);
      const live = await textOf(d, label);
      if (!/^Working for \d+s/u.test(live)) throw new Error(`The running turn's trail is not counting: ${JSON.stringify(live)}`);
      await d.zoom(trail, 1.35);
      await cameraRested(d);
      await d.pause(2_000);
      const later = await textOf(d, label);
      // A settled `Worked for …` is not the clock moving: the second reading must still be the live count.
      if (!/^Working for \d+s/u.test(later)) throw new Error(`The trail stopped counting while the turn runs: ${JSON.stringify(later)}`);
      if (later === live) throw new Error(`The live trail's clock never moved on from ${JSON.stringify(live)}.`);
      await d.caption("A clock while it runs");
      await d.pause(3_000);
      // The turn settles: the same summary names what the calls did, count by count, and marks the one that failed. The
      // count wording is the wait because both honest settled forms carry it — the measured clock (`Worked for 12s ·
      // 1 read, 3 runs`) and the count-only one (`Used 4 tools · 1 read, 3 runs`) — where waiting for `Worked for` alone
      // would fail on the form the warning below is for. `:not(…--live)` keeps the live count, which carries the same
      // counts, from standing in for the settled label.
      await d.waitFor({ css: `${label}:not(.chat-activity-trail__label--live)`, contains: "1 read, 3 runs" }, 120_000);
      const settled = await textOf(d, label);
      if (!settled.includes("1 read, 3 runs")) throw new Error(`The settled trail does not count the turn's calls: ${JSON.stringify(settled)}`);
      // The measured clock is what the feature promises. A scripted model whose tool items carry no timestamps would
      // leave the count-only wording, which is honest but a proof gap: the run says so instead of inventing a duration.
      if (!/^Worked for \d+s/u.test(settled)) process.stderr.write(`The trail settled without a measured clock: ${JSON.stringify(settled)}\n`);
      await d.caption("Every call, counted");
      await d.pause(3_000);
      const mark = await d.waitFor({ css: "span.chat-activity-trail__failed" }, 20_000);
      const failed = await textOf(d, "span.chat-activity-trail__failed");
      if (failed !== "failed") throw new Error(`The trail's failed mark reads ${JSON.stringify(failed)}.`);
      await d.zoom(mark, 1.9);
      await cameraRested(d);
      await d.caption("Its failed run is marked");
      await d.pause(3_000);
      // The chips hang on the folded summary: the file the read named and the pull request a command printed.
      const file = await d.find({ css: "span.tool-call-chip--file" });
      if (!file) throw new Error("The trail's summary draws no file chip.");
      const pull = await d.waitFor({ css: "a.tool-call-chip--pr" }, 20_000);
      const href = await d.stage<string>(`document.getElementById("app").contentDocument.querySelector("a.tool-call-chip--pr")?.getAttribute("href") ?? ""`);
      if (href !== "https://github.com/acme/storefront/pull/482") throw new Error(`The pull request chip points at ${JSON.stringify(href)}.`);
      await d.zoom({ x: (file.x + pull.x + pull.width) / 2, y: pull.y + pull.height / 2 }, 1.6);
      await cameraRested(d);
      await d.caption("The files and PRs it touched");
      await d.pause(3_000);
      // Opened, the trail draws the base app's tool card: its header counts the calls and every call is a row. The
      // caption of the fold leaves first, so the click and the card that lands under it are one clean picture.
      await d.caption();
      await d.zoom();
      await d.pause(600);
      await d.click(summary);
      await d.waitFor({ contains: "Used 4 tools" }, 20_000);
      const titles = await textsOf(d, ".tool-call-row__title");
      if (titles.length !== 4) throw new Error(`The opened trail draws ${titles.length} call rows, not four: ${JSON.stringify(titles)}`);
      await d.zoom(trail, 1.3);
      await cameraRested(d);
      await d.caption("Open it for every call");
      await d.pause(3_000);
      await d.zoom();
      await d.caption();
    },
  },
  {
    name: "attachments",
    chapter: "Attachments",
    viewport: [1280, 720],
    path: "/sessions/demo-1",
    ready: "Apple Pay at checkout",
    // A note and a picture for the picker to hand over, made in this clip's own temporary folder: a fixture is never
    // committed, and the picture is a real 448×252 PNG so the message's own thumbnail draws a photo, not a dot.
    async setup() {
      attachmentDir = await mkdtemp(join(tmpdir(), "hui-demo-attachments-"));
      notesFile = join(attachmentDir, "acme-release-notes.txt");
      photoFile = join(attachmentDir, "acme-sunset.png");
      await writeFile(notesFile, "Release 0.2.2\n- The composer keeps its blocks\n- A bot's queue shows what it started\n- The activity trail counts the turn\n");
      await writeFile(photoFile, Buffer.from(SUNSET_PNG, "base64"));
    },
    async run({ director: d }) {
      const name = basename(notesFile), picture = basename(photoFile);
      const preview = { css: "ul.chat-attachments-preview" };
      // The attach menu: the camera, the photo library and a file, over the composer they belong to.
      await d.click({ label: "Add attachment" });
      const popup = await d.waitFor({ css: ".agent-chat__attach-popup", contains: "Take photo" }, 15_000);
      const options = await textsOf(d, ".agent-chat__attach-menu-option [data-part='label']");
      if (options.join("|") !== "Take photo|Photo|File") throw new Error(`The attach menu offers ${JSON.stringify(options)}.`);
      await d.caption("A file, a photo or the camera");
      await d.zoom({ x: popup.x + popup.width / 2, y: popup.y + popup.height / 2 }, 1.25);
      await cameraRested(d);
      await d.pause(3_000);
      // A file and no words at all: the picker's hidden input takes the path, the draft shows the file, and Send opens.
      await d.upload("input.agent-chat__generic-file-input", [notesFile]);
      await d.waitFor({ css: preview.css, contains: name }, 15_000);
      if (await composerWire(d, "text") !== "") throw new Error("The draft is not empty, so the send would prove nothing about a file alone.");
      await d.zoom();
      await d.caption("Send the file, with no words");
      await d.pause(3_000);
      await d.click({ label: "Send message" });
      await d.waitFor({ css: ".chat-group.user .chat-assistant-attachment-card__title", text: name }, 30_000);
      const sent = await d.stage<{ title: string; meta: string; text: string; painted: boolean }>(`(() => {
        const rows = [...document.getElementById("app").contentDocument.querySelectorAll(".chat-group.user")];
        const row = rows.at(-1);
        const text = row?.querySelector('[data-testid="message-text"]');
        const box = text?.getBoundingClientRect();
        return {
          title: row?.querySelector(".chat-assistant-attachment-card__title")?.textContent?.trim() ?? "",
          meta: row?.querySelector(".chat-assistant-attachment-card__meta")?.textContent?.trim() ?? "",
          text: (text?.textContent ?? "").trim(),
          painted: Boolean(box && box.width >= 1 && box.height >= 1),
        };
      })()`);
      if (sent.title !== name) throw new Error(`The sent row's card names ${JSON.stringify(sent.title)}, not ${JSON.stringify(name)}.`);
      if (sent.meta !== "TXT") throw new Error(`The sent row's card reads ${JSON.stringify(sent.meta)}, not TXT.`);
      if (sent.text !== "" || sent.painted) throw new Error(`The file-only row drew a text bubble: ${JSON.stringify(sent)}`);
      await d.caption("The file is the whole prompt");
      await d.zoom({ css: ".chat-group.user", last: true }, 1.5);
      await cameraRested(d);
      await d.pause(3_000);
      // The same again with a picture alone: its own thumbnail, under the same filename.
      await gone(d, { css: ".chat-group--working" }, 90_000);
      await d.zoom();
      await d.waitFor({ placeholder: "Send a message…" }, 30_000);
      await d.click({ label: "Add attachment" });
      await d.waitFor({ css: ".agent-chat__attach-popup", contains: "Photo" }, 15_000);
      await d.upload("input.agent-chat__photo-input", [photoFile]);
      await d.waitFor({ css: `${preview.css} img` }, 15_000);
      const alt = await d.stage<string>(`document.getElementById("app").contentDocument.querySelector("ul.chat-attachments-preview img")?.getAttribute("alt") ?? ""`);
      if (alt !== picture) throw new Error(`The draft's preview names ${JSON.stringify(alt)}, not ${JSON.stringify(picture)}.`);
      // The preview is a picture, not an empty frame: its bitmap decoded before the message is sent.
      await decodedImage(d, `${preview.css} img`);
      await d.caption("A photo alone sends too");
      await d.pause(3_000);
      await d.click({ label: "Send message" });
      await d.waitFor({ css: "figure.hui-message-attachment-image img.chat-message-image" }, 30_000);
      const images = await d.stage<string[]>(`(() => [...document.getElementById("app").contentDocument
        .querySelectorAll("figure.hui-message-attachment-image img.chat-message-image")].map((img) => img.getAttribute("alt") ?? ""))()`);
      if (!images.includes(picture)) throw new Error(`The transcript's picture is named ${JSON.stringify(images)}, not ${JSON.stringify(picture)}.`);
      // A failed load keeps the `img` and its `alt` and swaps in the fallback card under it, so the name alone is not the
      // photo: the figure must not be marked failed and the bitmap must have decoded, before the beat captions it.
      await decodedImage(d, "figure.hui-message-attachment-image img.chat-message-image");
      await d.zoom({ css: "figure.hui-message-attachment-image" }, 1.5);
      await cameraRested(d);
      await d.pause(3_000);
      // And nothing typed with nothing attached still refuses: the send is disabled, and is framed, never pressed.
      await gone(d, { css: ".chat-group--working" }, 90_000);
      await d.zoom();
      await d.waitFor({ placeholder: "Send a message…" }, 30_000);
      const refused = await d.stage<boolean>(`document.getElementById("app").contentDocument.querySelector("button.chat-send-btn")?.disabled === true`);
      if (!refused) throw new Error("The send button is enabled on an empty composer with nothing attached.");
      const button = await d.waitFor({ css: "button.chat-send-btn" }, 10_000);
      // Framed wide: a zoom puts the composer at the bottom of the stage, where the caption band would cover the button
      // the beat is about. The pointer rests on it instead, so the disabled control is what the eye lands on.
      await d.move({ x: button.x + button.width / 2, y: button.y + button.height / 2 });
      await d.caption("Empty still refuses to send");
      await d.pause(3_000);
      await d.caption();
      await rm(attachmentDir, { recursive: true, force: true });
    },
  },
  {
    name: "cost",
    chapter: "Cost and context",
    viewport: [1280, 720],
    path: "/sessions/demo-11",
    ready: { contains: "It drifted" },
    narration: {
      context: "Every conversation shows what its context carries: the system prompt, the tool definitions, and the conversation itself.",
      total: "The same meter says what every model call in the session has cost so far.",
      usage: "And Usage adds the sessions up: what a recorded call costs on average, the share the cache served, and what each session spent.",
    },
    async run({ director: d }) {
      await narrate(d, "What this context carries", "context");
      await d.click({ css: ".context-ring" });
      await d.waitFor({ css: ".context-usage__breakdown" });
      // The popover hangs under the composer, so at 1.7 the camera is already pinned to the window's bottom edge and a
      // move onto the total below the split frames the same pixels. At 1.5 the whole popover fits and the move is a real
      // one: the split by system prompt, tool definitions and conversation, then the session's own spend under it.
      await d.zoom({ css: ".context-usage__popover" }, 1.5);
      await d.pause(2_400);
      await narrate(d, "…and what its calls cost", "total");
      // The same meter counts the session's calls below the split, so the camera moves onto that block under the line.
      await d.zoom({ css: ".context-usage__stats" }, 2.2);
      await d.pause(2_000);
      await d.zoom();

      // The Usage page's report takes a few seconds to arrive. The click on its link and that wait are a cut: the line
      // that reads the page then starts on the loaded page, instead of over four seconds of the session page standing
      // still while the cursor glides and Usage loads.
      await d.quiet();
      await d.cut(async () => {
        await d.click(link("Usage"));
        await d.waitFor({ css: "[data-testid='usage-report'][aria-busy='false']" }, 30_000);
        await d.waitFor({ css: "[data-testid='usage-totals']" }, 30_000);
        await reveal(d, ".usage-summary-grid");
        await caughtUp(d);
      });
      await narrate(d, "Cost and cache, across sessions", "usage");
      // The line names the average cost first, then the cache share, then each session: its beats follow in that order.
      // A card's own factor keeps the Usage overview heading and the Errors card beside it whole.
      await d.pause(700);
      await d.zoom({ css: ".usage-summary-card", contains: "Avg cost / record" }, 1.4);
      await d.pause(1_600);
      await d.zoom({ css: ".usage-summary-card", contains: "Cache hit rate" }, 1.4);
      // The last clause names the sessions: back the camera out and scroll them in under the wide page, which is also
      // the frame the clip ends on, so the last words need no zoom-out after them.
      await d.pause(1_000);
      await d.zoom();
      await reveal(d, "[data-testid='usage-session-row']");
      await d.quiet();
      await d.caption();
    },
  },
  {
    name: "workpane",
    chapter: "Terminal, diff and VS Code",
    path: "/sessions/demo-10",
    ready: { contains: "Format them as currency" },
    vscode: true,
    narration: {
      terminal: "Every conversation has a Work pane beside it. Open a terminal, already in the project's folder.",
      agent: "The agent can use the same terminal. You watch it run the tests, live.",
      diff: "The Diff view shows exactly what changed, file by file.",
      files: "Click a file to open it in the Files view,",
      vscode: "or open the whole project in V S Code, without leaving the browser.",
    },
    async run({ director: d }) {
      // A fresh profile opens the conversation with its Work pane on the rail, where only Show Work pane exists. The pane
      // and its terminal are open before the line that names them.
      await d.cut(async () => {
        if (await d.find({ label: "Show Work pane" })) await d.click({ label: "Show Work pane" });
        await d.click({ label: "Open Work view" });
        await d.click({ css: ".work-pane__menu-item[value='launch:terminal']" });
        await d.waitFor({ contains: "Shared · Connected" });
        await d.waitFor({ css: ".hui-terminal-surface" });
        await caughtUp(d);
      });
      await d.caption("Every conversation has a Work pane");
      await d.say("terminal");
      const terminal = await d.waitFor({ css: ".hui-terminal-surface" });
      // The prompt and output sit at the top of the terminal.
      const output = { x: terminal.x + terminal.width / 2, y: terminal.y + 150 };
      await d.zoom(output, 1.5);
      await d.click({ x: terminal.x + 120, y: terminal.y + 40 });
      await d.type("git status --short && git log --oneline -1", { terminal: true });
      await d.press("Enter");
      await d.pause(1_400);
      await d.quiet();
      await d.zoom();

      // The agent's turn ends with the tests passing in the same terminal, and that is the picture its line describes.
      await d.cut(async () => {
        await send(d, "Go ahead, and run the tests in my terminal");
        await d.waitFor({ contains: "3 tests pass in your terminal" }, 40_000);
        await d.zoom(output, 1.5);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("The agent can type in your terminal too");
      await d.say("agent");
      await d.pause(1_200);
      await d.quiet();
      await d.zoom();

      // Opening the diff, its file and the side-by-side view is the wait, not the beat: the line starts on the change.
      await d.cut(async () => {
        await d.click({ label: "Maximize Work pane" });
        await d.click({ label: "Open Work view" });
        await d.click({ css: ".work-pane__menu-item[value='launch:diff']" });
        await d.click({ css: ".hui-diff-file[data-path='src/orders/orders-page.js']" });
        await d.click({ css: ".hui-diff-segmented__option", text: "Side by side" });
        await d.waitFor({ contains: "formatTotal(order.total" });
        await d.zoom({ css: ".hui-diff-main" }, 1.4);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Every change, in the Diff view");
      await d.say("diff");
      await d.pause(2_200);
      await d.quiet();

      await d.cut(async () => {
        await d.zoom();
        await d.click({ css: ".hui-diff-main__open" });
        await d.waitFor({ css: ".hui-files-editor" });
        await d.pause(1_800);
        await caughtUp(d);
      });
      await d.caption("Open a file in Files");
      await d.say("files");
      await d.pause(1_200);
      await d.quiet();

      // VS Code's server starts (and is already installed before this run); the clip skips the wait.
      await d.cut(async () => {
        await d.click({ label: "Open Work view" });
        await d.click({ css: ".work-pane__menu-item[value='launch:vscode']" });
        await d.waitFor({ css: "[aria-label^='Source Control']" }, 300_000);
        await d.pause(800);
        await d.click({ css: "[aria-label^='Source Control']" });
        await d.click({ css: ".monaco-list-row", contains: "orders-page.js" });
        await d.pause(1_000);
        await d.zoom({ css: ".monaco-workbench" }, 1.3);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("…or the whole project in VS Code");
      await d.say("vscode");
      await d.quiet();
      await d.zoom();
      await d.caption();
    },
  },
  {
    name: "subagents",
    chapter: "Subagents and watchers",
    viewport: [1280, 720],
    ready: "Apple Pay at checkout",
    narration: {
      ask: "Big jobs can be split up. Here, one code review becomes three, running in parallel.",
      children: "Run status tracks every helper while the agent waits for all of them.",
      report: "When they're done, the agent sums up what they found.",
      open: "You can open any of them to see exactly what it did.",
      parent: "Its task shows the session that sent it. Click the name to go back.",
      goal: "Give the conversation a goal, and it keeps going on its own, ten turns at a time, until the objective is done.",
      watcher: "For things that take a while, like CI, the agent leaves a watcher behind. It waits in the background, and merges once the checks go green.",
      done: "The checks passed, the watcher merged, and it says Done in the chat.",
    },
    async run({ director: d }) {
      await narrate(d, "Ask for a review that splits three ways", "ask");
      await d.click({ label: "New session in PAYMENTS" });
      await d.click({ placeholder: "What should this session work on?" });
      await d.type("Review PR #142 before we merge: security, performance and test coverage, in parallel");
      await d.press("Enter");

      // The helpers' run leaves the panel shut; open it and wait for the rows before the line names them.
      await openRunStatus(d);
      await unfoldHelpers(d);
      await narrate(d, "Run status tracks every helper", "children");
      await unfoldHelpers(d);
      await d.waitFor({ css: ".chat-run-status__helpers-list" }, 30_000);
      await d.zoom({ css: ".chat-run-status__panel" }, 1.6);
      await d.pause(2_400);
      await d.zoom();

      // The summary streams into a chat row behind the panel, and its line reads the finished verdict table. The panel
      // closing, the run settling and the table painting are one cut, so the line starts on the whole table instead of
      // over a half-drawn verdict with a Working… row under it.
      await d.quiet();
      await d.cut(async () => {
        // The panel would cover the table's right side.
        await closeRunStatus(d);
        await d.waitFor({ contains: "I'd fix the ownership check before merging." }, 40_000);
        await gone(d, { css: ".chat-group--working" }, 40_000);
        await centre(d, { css: "[data-testid='message-row']", contains: "All three reviews are in" });
        await caughtUp(d);
      });
      await narrate(d, "…and the agent sums them up", "report");
      await d.zoom({ css: "[data-testid='message-row']", contains: "All three reviews are in" }, 1.3);
      await d.pause(2_200);
      await d.zoom();

      // The goal is given as its line starts: the command lands in the composer under "give the conversation a goal",
      // and the panel it opens carries the rest of the line. Typing it out first left fifteen seconds of silence here.
      await d.click({ placeholder: "Send a message…" });
      const typing = d.type("/goal get the ownership check in and #142 merged");
      await d.caption("Give it a goal, and it keeps going");
      await d.say("goal");
      await typing;
      await d.press("Enter");
      // HUI's own note floats over the header; it is an outside click for the panel's popover, so dismiss it before the
      // panel opens. Then the panel and its pause note are what the rest of the line describes.
      await d.waitFor({ css: ".app-toast.chat-operation-toast .app-toast__dismiss" }, 10_000);
      await dismissNote(d, "Goal set.");
      await openRunStatus(d);
      await d.waitFor({ css: ".chat-run-status__objective" }, 20_000);
      // Park the cursor over the chrome, off the page, before the plan is framed: no tooltip is left over it.
      await park(d);
      await d.zoom({ css: ".chat-run-status__section[aria-labelledby$='goal-title']" }, 1.7);
      await d.pause(2_400);
      await d.zoom();

      // Open a helper only once its pane shows what it did; a header with an empty body is not the beat. The pane's load
      // is a cut: the goal's line stays on the panel, then the opened helper arrives with its work already on screen.
      await unfoldHelpers(d);
      const helper = { css: ".chat-run-status__helper", contains: "Security review" };
      await d.waitFor(helper, 20_000);
      await centre(d, helper);
      await narrate(d, "Open any helper to see its work", "open");
      await d.cut(async () => {
        await d.click(helper);
        await d.waitFor({ css: ".session-history-action[aria-label='Open parent']" }, 20_000);
        await d.waitFor({ contains: "1 blocking issue" }, 30_000);
      });
      await d.zoom({ contains: "1 blocking issue" }, 1.4);
      await d.pause(2_200);
      await d.zoom();

      // Its task names the parent session: its sender line loads after the task, so wait for that line itself before the
      // caption, then scroll the task row in and name the sender under the line.
      const task = { css: ".chat-group--peer", contains: "Security review of PR #142" };
      await d.waitFor(task, 20_000);
      const sender = { css: ".chat-sender-link", text: "Review PR #142 in parallel" };
      await d.waitFor(sender, 20_000);
      await centre(d, task);
      // The sender footer is a hover/focus detail: it is in the DOM but transparent until the row is hovered, so the
      // cursor reveals it before the line that names it and keeps it up while the task is framed.
      await d.move(task);
      await d.pause(400);
      await narrate(d, "Its task names the session that sent it", "parent");
      await d.zoom(task, 1.5);
      await d.pause(2_000);
      await d.zoom();
      await d.click(sender);

      // The watcher row lives below the goal and helpers in the panel. The prompt that starts it and its run are a cut:
      // typing them out and waiting for the row added thirteen silent seconds to the clip before the watcher's line.
      const watcher = { css: ".chat-watcher", contains: "Merge #142 when CI is green" };
      await d.cut(async () => {
        await send(d, "Fix the ownership check, then merge once CI is green");
        await openRunStatus(d);
        await d.waitFor(watcher, 30_000);
        await centre(d, watcher);
        await cameraRested(d);
      });
      await narrate(d, "Watchers wait on CI for you", "watcher");
      await d.zoom(watcher, 1.4);
      await d.pause(1_500);
      // HUI checks on watchers every 10 s, so the checks go green a while after the line. That wait and the reframe are
      // a cut: the closing line starts on the framed Done card, not six seconds after the last word.
      await d.quiet();
      const event = { css: ".chat-group--watcher-event", contains: "Watcher finished: Merge #142 when CI is green" };
      await d.cut(async () => {
        await d.waitFor({ contains: "CI green, merged #142" }, 30_000);
        // A settled watcher writes its own event into the conversation, where the open panel would cover its right side.
        await d.waitFor(event, 20_000);
        await d.waitFor({ css: ".chat-group--watcher-event .chat-subagents__snippet", contains: "Done" }, 20_000);
        // The close control is in the panel's head, above the zoomed watcher row: back the camera out first, or the tap
        // lands outside the frame and the panel stays over the card.
        await d.zoom();
        await closeRunStatus(d);
        await centre(d, event);
        await d.zoom(event, 1.4);
        await caughtUp(d);
      });
      await narrate(d, "Done: checks green, #142 merged", "done");
      await d.pause(2_400);
      // The goal chip sits in the header, under where the panel's close control left the cursor; the closing wide shot
      // has no pointer on it.
      await parkCursor(d);
      await d.zoom();
      await d.quiet();
      await d.caption();
    },
  },
  {
    name: "bots",
    chapter: "Bots",
    viewport: [1280, 720],
    ready: "Apple Pay at checkout",
    async setup({ api }) {
      // A fresh HUI seeds its own ungrouped Chief of Staff on first boot, and the storefront group's chief below replaces
      // it on this roster: archive the seeded one (an archive, never a permanent delete, so the demo world stays
      // recoverable), so the roster is the four bots the clip is about. A refusal is reported in the server's own words
      // and the roster is left as it is.
      try {
        const { bots } = await api("GET", "/__hui/bots");
        const seeded = (bots as { id: string; title?: string; group?: string }[]).find((entry) => entry.title === "Chief of Staff" && !entry.group);
        if (seeded) await api("DELETE", `/__hui/bots/${seeded.id}`);
      } catch (error) {
        process.stderr.write(`The seeded Chief of Staff stayed on the roster: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      const { bot } = await api("POST", "/__hui/bots", { name: "Scout", title: "Release captain", avatar: { shape: "blob", color: "#5b8cff" }, soul: soul("Scout, the team's release captain.") });
      await api("POST", "/__hui/bots", { name: "Pixel", title: "Design reviewer", avatar: { shape: "heart", color: "#ff7a6b", ears: "cat" }, soul: soul("Pixel, who reviews UI changes.") });
      await api("POST", "/__hui/bots", { name: "Owl", title: "On-call SRE", avatar: { emoji: "🦉" }, soul: soul("Owl, the on-call SRE who watches the pager overnight.") });
      // The sessions below are started by the storefront group's chief, made before the clip so its arrival is not the beat.
      const { bot: chief } = await api("POST", "/__hui/staff/chiefs", { group: "Storefront" });
      storefrontChief = { id: chief.id, name: chief.name, handle: chief.handle };
      await api("POST", `/__hui/bots/${bot.id}/messages`, { text: "Heads-up: refunds roll out to 10% of stores on Monday, and Priya owns the rollback.", wait: true });
    },
    narration: {
      roster: "Bots are agents that stay. Each one has a face, a single long-running chat, and a memory.",
      start: "Ask one for work, and it starts the sessions itself, one brief each.",
      started: "The run lists both, and each session says which bot started it.",
      routine: "They schedule their own routines. Ask Scout for a weekday digest, and it sets one up.",
      run: "Run it now, and the digest already knows what you told it earlier.",
      handoff: "Agents hand a bot work by tagging it. You see what they sent, next to the bot's face.",
      reply: "Scout answers right in the agent's chat, under its own face.",
    },
    async run({ director: d }) {
      // The roster the line names is on screen before it speaks: the tab and the list are the click on the loaded app.
      await d.click({ css: "#sidebar-tab-bots" });
      await d.waitFor("Owl");
      await d.zoom({ css: ".bot-roster" }, 1.8);
      await d.caption("Bots are agents that stay");
      await d.say("roster");
      await d.pause(3_000);
      await d.quiet();
      await d.zoom();

      // The sessions a bot started: the chief opens two itself, and the creations (up to two minutes) are the cut. Its
      // chat and composer are ready before the line that asks for them.
      await d.cut(async () => {
        await d.click({ css: ".bot-row__name", text: storefrontChief.name });
        await d.waitFor({ css: ".ProseMirror[aria-label='Message']" }, 60_000);
        await d.click({ label: "Message" });
        await caughtUp(d);
      });
      await d.caption("Ask a bot to start the work");
      await d.say("start");
      await d.pause(3_000);
      await d.type("Start the orders CSV export and the flaky checkout test fix");
      await d.press("Enter");
      await d.cut(async () => {
        await d.waitFor({ contains: "Two sessions are up" }, 180_000);
        await openRunStatus(d);
        await d.waitFor({ css: ".chat-run-status__session", nth: 1 }, 30_000);
        await d.zoom({ css: "section[aria-label='Sessions']" }, 1.45);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("The run lists both sessions");
      await d.say("started");
      await d.pause(3_000);
      await d.quiet();
      await d.zoom();

      // Open one from the run: its header names the bot that started it, and so does its sidebar row.
      await d.click({ css: ".chat-run-status__session", nth: 0 });
      await d.waitFor({ css: "[data-testid='chat-pane-creator']" }, 30_000);
      await d.click({ css: "#sidebar-tab-sessions" });
      await scrollIn(d, '[data-testid="session-row-creator"]');
      await d.waitFor({ css: "[data-testid='session-row-creator']" }, 15_000);
      await d.caption("Started by a bot, with its brief");
      await d.zoom({ css: "[data-testid='chat-pane-creator']" }, 1.9);
      await d.pause(3_000);
      // The chip leads back to the bot that started it, where its own line about the two sessions sits. Its caption leaves
      // with the session header it describes, before the picture becomes the bot's chat.
      await d.caption();
      await d.click({ css: "[data-testid='chat-pane-creator']" });
      await centreInThread(d, { contains: "Two sessions are up" });
      await d.zoom();
      await d.pause(800);

      // Scout's chat with the routine already set up is the picture the line names: the request and its answer are a cut.
      await d.cut(async () => {
        await d.click({ css: "#sidebar-tab-bots" });
        await d.click({ css: ".bot-row__name", text: "Scout" });
        await send(d, "Every weekday at 9, post a digest of open PRs and today's rollouts");
        await d.waitFor({ contains: "runs every weekday at 9:00" }, 30_000);
        await caughtUp(d);
      });
      await d.caption("They schedule their own routines");
      await d.say("routine");
      await d.pause(3_000);
      await d.quiet();

      // Running the routine and waiting for the digest it writes are the cut before its line.
      await d.cut(async () => {
        await d.click({ css: ".bot-overview__name", text: "Morning digest" });
        await d.click({ label: "Run now: Morning digest" });
        await d.waitFor({ contains: "Nothing is blocked" }, 30_000);
        await d.zoom({ contains: "Priya owns the rollback", last: true }, 1.4);
        await cameraRested(d);
        await caughtUp(d);
      });
      await park(d);
      await d.caption("Run one now, and it remembers");
      await d.say("run");
      await d.pause(3_000);
      await d.quiet();
      await d.zoom();

      // Sending the tagged message, the handoff row it writes and Scout's answer are the wait: the line starts on the
      // handoff card, not on a composer still being typed into.
      await d.cut(async () => {
        await d.click({ css: "#sidebar-tab-sessions" });
        await d.click({ css: "a", contains: "Apple Pay at checkout" });
        await d.waitFor({ contains: "merchant validation endpoint next" });
        await send(d, "@scout make sure Apple Pay is on Monday's rollout");
        await d.waitFor({ css: ".chat-handoff" }, 30_000);
        await park(d);
        await d.zoom({ css: ".chat-handoff" }, 1.6);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Agents hand bots work with @");
      await d.say("handoff");
      await d.pause(3_000);
      await d.quiet();
      await d.zoom();

      await d.cut(async () => {
        await d.waitFor({ css: ".chat-group--peer" }, 30_000);
        await d.zoom({ css: ".chat-group--peer" }, 1.5);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Scout answers in the agent's chat");
      await d.say("reply");
      await d.pause(3_000);
      await d.quiet();
      await botWorkQueue(d);
      await d.zoom();
      await d.caption();
      await d.pause(1_500);
    },
  },
  {
    name: "teamwork",
    chapter: "Bots working together",
    viewport: [1280, 720],
    ready: "Apple Pay at checkout",
    async setup({ api }) {
      await api("POST", "/__hui/bots", { name: "Piper", title: "PR shepherd", avatar: { shape: "blob", color: "#34c38f" }, soul: soul("Piper, who watches pull requests until they merge.") });
      const { bot: owl } = await api("POST", "/__hui/bots", { name: "Owl", title: "On-call SRE", avatar: { emoji: "🦉" }, soul: soul("Owl, the on-call SRE for payments.") });
      await api("POST", "/__hui/bots", { name: "Pixel", title: "Design reviewer", avatar: { shape: "heart", color: "#ff7a6b", ears: "cat" }, soul: soul("Pixel, who reviews UI changes.") });
      const { hook } = await api("POST", `/__hui/bots/${owl.id}/triggers`, {
        name: "Pages", source: "listener", filter: { match: { field: "fields.channel", op: "equals", value: "payments-oncall" } },
        prompt: "Investigate this page. Hand any code fix to @piper.", cooldownSeconds: 0,
      });
      pagesHook = hook.path;
      await api("POST", pagesHook, { events: [] });
    },
    narration: {
      team: "Bots don't work alone. They take work from agents, and from each other.",
      handoff: "When an agent opens a pull request, it hands it to Piper, the P R shepherd.",
      question: "Piper watches C I, and brings the reviewer's question back to the agent that wrote the code.",
      answer: "The agent makes the call, and Piper takes it from there.",
      trigger: "Triggers wake a bot when something happens elsewhere. Here, a small listener watches the on-call channel for Owl.",
      page: "A page comes in, and Owl starts digging right away.",
      bots: "Owl finds the bad deploy, and tags Piper to revert it. Bots hand work to each other, too.",
      reverted: "Piper reverts it, and reports back to Owl.",
      follow: "Click a name to see the other side of the conversation.",
    },
    async run({ director: d, api }) {
      // The roster the line names is on screen before it speaks: the tabs and the roster are the cut before the first line.
      await d.cut(async () => {
        await d.click({ css: "#sidebar-tab-bots" });
        await d.waitFor({ css: ".bot-row__name", text: "Pixel" });
        await d.zoom({ css: ".bot-roster" }, 1.8);
      });
      await d.caption("Bots work with agents, and with each other");
      await d.say("team");
      await d.pause(1_800);
      await d.quiet();
      await d.zoom();

      await d.cut(async () => {
        await d.click({ css: "#sidebar-tab-sessions" });
        // The sidebar lists the group it scrolled to last; searching brings the session to the top, where the click is
        // reliable while the list re-renders.
        await d.click({ placeholder: "Search sessions" });
        await d.type("Retry-safe");
        await d.click({ css: "a", contains: "Retry-safe webhooks" });
        await d.waitFor({ contains: "Tests cover duplicates" });
        await caughtUp(d);
      });
      await d.caption("An agent hands its PR to Piper");
      await d.say("handoff");
      await d.pause(1_200);
      await d.quiet();

      // The agent tags Piper and the handoff row it writes is the picture the line describes, so both are the cut.
      await d.cut(async () => {
        await send(d, "Open the PR, and ask @piper to watch it until it merges");
        await d.waitFor({ css: ".chat-handoff" }, 30_000);
        await centre(d, { css: ".chat-handoff" });
        await d.zoom({ css: ".chat-handoff" }, 1.6);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Piper brings the reviewer's question back");
      await d.say("question");
      await d.pause(1_800);
      await d.quiet();
      await d.zoom();

      await d.cut(async () => {
        await d.waitFor({ css: ".chat-group--peer", contains: "Lee asks" }, 30_000);
        await centre(d, { css: ".chat-group--peer", contains: "Lee asks" });
        await d.zoom({ css: ".chat-group--peer", contains: "Lee asks" }, 1.5);
        await cameraRested(d);
        await caughtUp(d);
      });
      // The reviewer's question is on screen; the answer line belongs to the beat below, where the agent has answered it.
      await d.pause(1_800);
      await d.quiet();
      await d.zoom();

      await d.cut(async () => {
        await d.waitFor({ contains: "Answered Lee through Piper" }, 30_000);
        await centre(d, { css: ".chat-handoff", last: true });
        await d.zoom({ css: ".chat-handoff", last: true }, 1.5);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("The agent decides, and answers");
      await d.say("answer");
      await d.pause(1_800);
      await d.quiet();
      await d.zoom();

      // Owl's trigger is what the line names, so the navigation to it comes first.
      await d.cut(async () => {
        await d.click({ css: "#sidebar-tab-bots" });
        await d.click({ css: ".bot-row__name", text: "Owl" });
        await d.waitFor({ css: "section[aria-labelledby$='overview-triggers']", contains: "Pages" });
        await d.zoom({ css: "section[aria-labelledby$='overview-triggers']" }, 1.6);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Triggers wake a bot");
      await d.say("trigger");
      await d.pause(1_800);
      await d.quiet();
      await d.zoom();
      await d.cut(async () => {
        await api("POST", pagesHook, { events: [{
          id: "page-4821", summary: "High error rate on POST /refunds", fields: { channel: "payments-oncall" },
          details: "payments-api: 12% of POST /refunds requests failed in the last 5 minutes (normally 0.1%). Started 14:02.",
        }] });
        await d.waitFor({ contains: "Investigate this page" }, 15_000);
        await d.zoom({ contains: "Investigate this page" }, 1.4);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("A page comes in, and Owl digs in");
      await d.say("page");
      await d.pause(1_400);
      await d.quiet();

      await d.cut(async () => {
        await d.waitFor({ css: ".chat-handoff" }, 30_000);
        await centre(d, { css: ".chat-handoff" });
        await d.zoom({ css: ".chat-handoff" }, 1.6);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Owl hands the revert to Piper");
      await d.say("bots");
      await d.pause(1_800);
      await d.quiet();
      await d.zoom();

      await d.cut(async () => {
        await d.waitFor({ css: ".chat-group--peer", contains: "Reverted" }, 30_000);
        await centre(d, { css: ".chat-group--peer", contains: "Reverted" });
        await d.zoom({ css: ".chat-group--peer", contains: "Reverted" }, 1.5);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Piper reverts it, and reports back");
      await d.say("reverted");
      await d.pause(1_800);
      await d.quiet();

      await d.cut(async () => {
        await d.waitFor({ contains: "Closing the page" }, 30_000);
        await d.click({ css: ".chat-sender-link", text: "Piper" });
        await d.waitFor({ css: ".chat-group--peer", contains: "Please revert" }, 15_000);
        await centre(d, { css: ".chat-group--peer", contains: "Please revert" });
        await d.zoom({ css: ".chat-group--peer", contains: "Please revert" }, 1.4);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Click a name to open that chat");
      await d.say("follow");
      await d.quiet();
      await d.zoom();
      await d.caption();
    },
  },
  {
    name: "share",
    chapter: "From a phone share",
    device: "phone",
    // What a phone's Share sheet opens: the shared link is already in HUI's new session composer.
    path: `/new-session?share=${encodeURIComponent("https://www.instagram.com/reel/C9xK2mPq/")}`,
    ready: { css: "#launch-prompt", value: "Look this post in Instagram" },
    narration: {
      share: "Share a post to H U I from your phone, and H U I opens a new session with the link already in the composer.",
      project: "Tap plus beside the project it belongs to, and send it. Nothing has to be pasted in.",
      answer: "The agent reads the code the post is about, and comes back with the next step.",
    },
    async run({ director: d }) {
      await narrate(d, "A shared post becomes a session", "share");
      await d.zoom({ css: "#launch-prompt" }, 1.35);
      await d.pause(2_400);
      await d.zoom();

      await narrate(d, "Tap + beside its project", "project");
      // The drawer's group action puts the session in the project the post is about, and keeps the shared text. The
      // plus is the control beside STOREFRONT; the caption and line name it instead of the icon-only button.
      await d.click({ label: "Open navigation" });
      await d.waitFor({ css: ".sidebar[data-open='true']" }, 10_000);
      await d.pause(600);
      await d.move({ label: "New session in STOREFRONT" });
      await d.pause(500);
      await d.click({ label: "New session in STOREFRONT" });
      // The new session screen replaces the drawer, so the tap's caption goes with it: the next one names the send.
      // The seeded workspace's raw temporary path sits just above the composer; the camera takes the send row and the
      // shared text below it, where the path is out of the shot, and the cut ends once the move has finished, because
      // the frames before it lands still hold the path in frame.
      await d.cut(async () => {
        await d.waitFor({ css: "#launch-cwd", value: "storefront" }, 20_000);
        const send = await d.waitFor({ label: "Start session" }, 20_000);
        await d.zoom({ x: send.x + send.width / 2, y: send.y + send.height / 2 + 34 }, 2.2);
        await cameraRested(d);
      });
      await d.caption("Send it, nothing to paste");
      await d.click({ label: "Start session" });
      // The running session is a new beat with no line of its own; the send's caption ends with it here rather than
      // staying up over the answer.
      await d.caption();
      // The answer is on screen whole before its line: the settle and the wait are a cut, so the line does not start
      // over a half-drawn reply and a Working… row.
      await d.cut(async () => {
        await d.waitFor({ contains: "Want me to start?" }, 40_000);
        await gone(d, { css: ".chat-group--working" }, 40_000);
        await centre(d, { contains: "Want me to start?", last: true });
        await caughtUp(d);
      });
      await narrate(d, "The agent reads the code", "answer");
      await d.zoom({ contains: "Want me to start?", last: true }, 1.4);
      await d.pause(2_200);
      await d.zoom();
      await d.quiet();
      await d.caption();
    },
  },
  {
    name: "phone",
    chapter: "On your phone",
    device: "phone",
    path: "/sessions/demo-1",
    ready: { contains: "Add Apple Pay to checkout" },
    storage: { "hui.kanban-options": JSON.stringify({ groupBy: "custom" }) },
    narration: {
      phone: "And it all works on your phone. Reach your laptop over your private network, and your sessions are right there.",
      ask: "Check in on an agent from anywhere,",
      board: "or keep an eye on everything in flight, wherever you are.",
      hand: "Some work needs you: here the agent can't confirm a payment by itself.",
      takeover: "Take over its browser, right from your phone.",
      pay: "The page is live: tap Confirm, and the payment goes through.",
      back: "Then hand the page back to the agent.",
      confirm: "Ask it what happened, and it reads the page it can see.",
    },
    async run({ director: d }) {
      await d.caption("HUI works on your phone too");
      await d.say("phone");
      await d.pause(3_000);
      // The next caption lands when this line has finished, not a line and a half early, and the cut carries none.
      await d.quiet();
      await d.caption();

      // Typing, sending and the reply are the cut: the next line reads the answer the session came back with, not a
      // composer still being typed into.
      await d.cut(async () => {
        await d.click({ placeholder: "Send a message…" });
        await d.type("Quick status on Apple Pay?");
        // On a touch screen Return adds a line; the send button sends.
        await d.click({ label: "Send message" });
        await d.waitFor({ contains: "Want me to open the pull request?" }, 30_000);
        await d.zoom({ contains: "Want me to open the pull request?" }, 1.35);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Check in from anywhere");
      await d.say("ask");
      await d.pause(3_000);
      await d.quiet();
      await d.zoom();

      // The Dashboard is what "everything in flight" names: the drawer, the navigation and its load are the cut.
      await d.cut(async () => {
        await d.click({ label: "Open navigation" });
        await d.pause(900);
        await d.click(link("Dashboard"));
        await d.waitFor({ contains: "The sessions in flight" });
        await d.pause(900);
        await d.zoom({ css: "[data-testid='dashboard-stats']" }, 1.35);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("Everything in flight, in your pocket");
      await d.say("board");
      await d.pause(3_000);
      await d.quiet();
      await d.zoom();

      // The agent opens the checkout and says it cannot pay; the session it asked in is a cut before its line.
      const asked = { contains: "take control of the page", last: true };
      await d.cut(async () => {
        await d.click({ label: "Open navigation" });
        await d.waitFor({ css: ".sidebar[data-open='true']" }, 10_000);
        await d.pause(500);
        await d.click({ css: "a", contains: "Apple Pay at checkout" });
        await d.waitFor({ contains: "Add Apple Pay to checkout" }, 30_000);
        await d.click({ placeholder: "Send a message…" });
        await d.type("Pay for the storefront order on staging");
        await d.click({ label: "Send message" });
        await d.waitFor(asked, 60_000);
        await centre(d, asked);
        await d.zoom(asked, 1.35);
        await cameraRested(d);
        await caughtUp(d);
      });
      await d.caption("The agent needs a hand");
      await d.say("hand");
      await d.pause(3_000);
      await d.quiet();

      // The Work view's browser pane is the page itself: opening it and waiting for the live view are the cut before
      // the line, so the takeover button is on screen when it is described. The camera stays wide until the page is the
      // operator's: zooming the pane pushes its toolbar, and the Take control button with it, above the top edge.
      await d.cut(async () => {
        await d.zoom();
        await d.click({ css: "[aria-label^='Active panel']" });
        await d.click({ css: ".picker-select__option", contains: "Browser" });
        await d.waitFor("Take control", 60_000);
        await caughtUp(d);
      });
      await d.caption("Take over its browser");
      await d.say("takeover");
      await d.pause(3_000);
      await d.quiet();
      await d.click({ css: "button", text: "Take control" });
      const frame = await d.waitFor({ label: "You have control of the page" }, 20_000);
      // The page is the operator's now: zoom until its own text reads on a phone screen.
      const confirm = { x: frame.x + frame.width * (CHECKOUT.x / CHECKOUT.width), y: frame.y + frame.height * (CHECKOUT.y / CHECKOUT.height) };
      await d.zoom(confirm, 1.8);
      await d.caption("The page is yours to drive");
      await d.say("pay");
      await d.pause(3_000);
      const before = await framePixels(d);
      await d.click(confirm);
      // The tap's proof is the page: the streamed picture redraws once the button's status line paints.
      await frameRepainted(d, before);
      await d.pause(2_500);
      await d.caption("Paid, right on the page");
      await d.pause(3_000);
      await d.quiet();
      // The handoff strip sits above the frame, off screen at this zoom: back the camera out or its button is tapped
      // past the stage's top edge and the lease never ends.
      await d.zoom();
      await cameraRested(d);
      await d.caption("Hand it back when done");
      await d.say("back");
      await d.pause(3_000);
      // The strip lives above the frame, so a camera still zoomed into the page leaves its button above the stage's top
      // edge, where the tap lands on nothing and the lease never ends: the button's stage point is proven on the stage
      // before it is tapped. `stage.toStage` maps into the stage page's own pixels, which this 1920×1080 layout draws at
      // 2×.
      const done = await d.waitFor({ css: "button.hui-browser-handoff__done" });
      const target = { x: done.x + done.width / 2, y: done.y + done.height / 2 };
      const point = await d.stage<{ x: number; y: number }>(`stage.toStage(${target.x}, ${target.y})`);
      if (point.x < 0 || point.y < 0 || point.x > 3840 || point.y > 2160) {
        throw new Error(`The Continue button is off the stage at (${Math.round(point.x)}, ${Math.round(point.y)}); the pane shows ${JSON.stringify(await handoffState(d))}.`);
      }
      await d.click(target);
      // The lease's own sentence in the pane's activity line is what proves it ended. The strip leaving proves nothing
      // on its own (a hidden pane hides it too), and an agent action while the lease stands is refused, which would
      // leave the follow-up below answering from no page at all.
      try {
        await d.waitFor({ css: ".hui-browser-activity__text", contains: "You finished; the agent is stopped." }, 15_000);
      } catch (error) {
        throw new Error(`The lease did not end; the pane shows ${JSON.stringify(await handoffState(d))}.`, { cause: error });
      }

      // Back in the chat, the agent reads the page the operator paid on: its answer quotes the page, or says plainly
      // that it could not confirm the payment.
      const answer = { contains: "the checkout page says", last: true };
      await d.cut(async () => {
        await d.zoom();
        await d.click({ css: "[aria-label^='Active panel']" });
        await d.click({ css: ".picker-select__option", contains: "Chat" });
        await d.waitFor({ placeholder: "Send a message…" }, 20_000);
        await d.click({ placeholder: "Send a message…" });
        await d.type("Did the payment go through?");
        await d.click({ label: "Send message" });
        // The answer lands under the browser card, and the thread is still where an earlier beat left it: the run is
        // over, so the thread goes to its last row and the answer is centred there. Otherwise the card above it leaves
        // the answer under the composer, and the line's own beat shows a page preview instead of the words it names.
        await gone(d, { css: ".chat-group--working" }, 60_000);
        await d.stage(`(() => {
          const thread = document.getElementById("app").contentDocument.querySelector(".chat-thread");
          thread.scrollTop = thread.scrollHeight;
          return thread.scrollTop;
        })()`);
        await d.pause(600);
        await centreInThread(d, answer);
        await caughtUp(d);
      });
      await d.zoom(answer, 1.35);
      await d.caption("The agent reads the real page");
      await d.say("confirm");
      await d.pause(3_000);
      await d.quiet();
      await d.zoom();
      await d.caption();
      await d.pause(1_500);
    },
  },
  chiefsScene,
];
