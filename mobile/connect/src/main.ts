/**
 * The Connect page's DOM wiring: restore what the shell remembers, probe the typed address, show the refusal or the
 * development-gateway notice, then hand the address to the app. All wording and checks live in `gateway.ts`.
 */
import { CHANGE_GATEWAY, CONNECTING, NOT_AN_ADDRESS, REFUSED, normalizeGateway, readSnapshot, versionNotice } from "./gateway";
import { connectGateway, forgetGateway, isNative, probeGateway, shellState } from "./native";
import "./style.css";

const form = document.querySelector<HTMLFormElement>("#connect-form");
const input = document.querySelector<HTMLInputElement>("#gateway");
const connect = document.querySelector<HTMLButtonElement>("#connect");
const status = document.querySelector<HTMLParagraphElement>("#status");
const change = document.querySelector<HTMLButtonElement>("#change-gateway");
if (!form || !input || !connect || !status || !change) throw new Error("the Connect page's markup changed under it");
change.textContent = CHANGE_GATEWAY;

function say(text: string, kind: "error" | "ok" | "notice" | "" = ""): void {
  status!.textContent = text;
  status!.dataset.kind = kind;
}

/** Show "Change gateway" only when the shell has something to change: a remembered address or one that failed. */
function showChange(gateway: string | null, failed: string | null): void {
  change!.hidden = gateway === null && failed === null;
}

async function restore(): Promise<void> {
  if (!isNative()) return;
  try {
    const { gateway, failed } = await shellState();
    if (failed !== null) {
      input!.value = failed;
      say(`The gateway at ${failed} didn't answer.`, "error");
    }
    showChange(gateway, failed);
  } catch (error) {
    console.warn("the app did not report its gateway", error);
  }
}

async function submit(): Promise<void> {
  const base = normalizeGateway(input!.value);
  if (base === null) {
    say(NOT_AN_ADDRESS, "error");
    return;
  }
  connect!.disabled = true;
  say(`Checking ${base}…`);
  try {
    const { status: code, body } = await probeGateway(base);
    const snapshot = code === 200 ? readSnapshot(body) : null;
    if (snapshot === null) {
      say(REFUSED, "error");
      return;
    }
    const notice = versionNotice(snapshot);
    say(notice ?? CONNECTING, notice === null ? "" : "notice");
    // The app remembers the address and reloads on it; a plain browser loads the gateway's own UI.
    if (isNative()) await connectGateway(base);
    else window.location.assign(base);
  } catch (error) {
    say(REFUSED, "error");
    console.warn("the gateway probe failed", error);
  } finally {
    connect!.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit();
});

change.addEventListener("click", () => {
  change!.disabled = true;
  void forgetGateway().catch((error: unknown) => {
    change!.disabled = false;
    say("The app couldn't forget this gateway.", "error");
    console.warn("the app did not forget its gateway", error);
  });
});

void restore();
