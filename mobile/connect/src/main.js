/* Spike S1: the bundled Connect page's only job is to find a HUI gateway, then hand its URL to the native shell. */
const form = document.querySelector("main");
const input = document.getElementById("gateway");
const button = document.getElementById("connect");
const status = document.getElementById("status");

const capacitor = window.Capacitor;
const native = capacitor?.isNativePlatform?.() === true;

function say(text, kind = "") {
  status.textContent = text;
  status.dataset.kind = kind;
}

function normalize(raw) {
  const value = raw.trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//iu.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.origin + parsed.pathname.replace(/\/+$/u, "");
  } catch {
    return null;
  }
}

function isHui(snapshot) {
  return Boolean(snapshot && typeof snapshot === "object" && "currentVersion" in snapshot && "job" in snapshot);
}

// A cross-origin fetch with the x-hui header is refused by the gateway's preflight (OPTIONS → 403), so on a device
// the probe goes through Capacitor's native HTTP, which never preflights. A plain browser falls back to fetch.
async function probe(base) {
  const url = `${base}/__hui/update`;
  const headers = { "x-hui": "1" };
  const http = capacitor?.Plugins?.CapacitorHttp;
  if (native && http) {
    const response = await http.get({ url, headers, connectTimeout: 5000, readTimeout: 5000 });
    const data = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    return { status: response.status, data };
  }
  const response = await fetch(url, { headers });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function connect() {
  const base = normalize(input.value);
  if (!base) {
    say("Enter an http:// or https:// address.");
    return;
  }
  button.disabled = true;
  say(`Checking ${base}…`);
  try {
    const { status: code, data } = await probe(base);
    if (code !== 200 || !isHui(data)) {
      say("This address doesn't answer as a HUI gateway.", "error");
      return;
    }
    say(`Connected to ${base} (HUI ${data.currentVersion}).`);
    if (native) await capacitor.Plugins.HuiGateway.connect({ url: base });
    else window.location.href = base;
  } catch (error) {
    say("This address doesn't answer as a HUI gateway.", "error");
    console.warn("gateway probe failed", error);
  } finally {
    button.disabled = false;
  }
}

button.addEventListener("click", connect);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void connect();
});

if (native) console.log(`connect page: Capacitor native, platform ${capacitor.getPlatform()}`);
