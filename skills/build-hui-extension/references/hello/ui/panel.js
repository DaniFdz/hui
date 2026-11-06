/** The smallest useful panel bridge: wait for init, call one declared route, render its answer. */
(() => {
  "use strict";
  const CHANNEL = "hui-extension";
  const pending = new Map();
  let nextCall = 1;
  const $ = (id) => document.getElementById(id);

  function post(message) {
    window.parent.postMessage({ channel: CHANNEL, ...message }, "*");
  }

  function call(method, path, body) {
    const callId = nextCall++;
    return new Promise((resolve, reject) => {
      pending.set(callId, { resolve, reject });
      post({ type: "call", callId, method, path, body });
    });
  }

  function applyTheme(theme) {
    if (!theme || typeof theme !== "object") return;
    if (typeof theme.text === "string" && theme.text) document.documentElement.style.setProperty("--fg", theme.text);
    document.documentElement.style.colorScheme = theme.mode === "dark" ? "dark" : "light";
  }

  async function greet(name) {
    const answer = await call("GET", `hello?name=${encodeURIComponent(name)}`);
    if (answer.status !== 200) throw new Error(answer.body?.error ?? "The route failed.");
    $("greeting").textContent = answer.body.greeting;
    $("status").textContent = "The route answered through the bridge.";
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    if (data.type === "init") {
      applyTheme(data.theme);
      $("status").textContent = "Ready.";
      return;
    }
    if (data.type === "theme") {
      applyTheme(data.theme);
      return;
    }
    if (data.type !== "result" && data.type !== "error") return;
    const entry = pending.get(data.callId);
    if (!entry) return;
    pending.delete(data.callId);
    if (data.type === "error") entry.reject(new Error(data.error));
    else entry.resolve(data);
  });

  $("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("name").value.trim() || "world";
    $("status").textContent = "Asking the gateway…";
    $("greeting").textContent = "";
    greet(name).catch((error) => {
      $("status").textContent = error instanceof Error ? error.message : "The route failed.";
    });
  });

  new ResizeObserver(() => {
    post({ type: "height", value: Math.ceil(document.documentElement.getBoundingClientRect().height) });
  }).observe(document.documentElement);

  post({ type: "title", value: "Hello" });
  post({ type: "ready" });
})();
