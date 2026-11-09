(() => {
  "use strict";
  const CHANNEL = "hui-extension";
  const pending = new Map();
  let nextCall = 1;
  const output = document.getElementById("greeting");

  function theme(value) {
    if (!value) return;
    document.documentElement.dataset.theme = value.mode ?? "";
    if (value.background) document.body.style.background = value.background;
    if (value.text) document.body.style.color = value.text;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    if (data.type === "init") { theme(data.theme); return; }
    if (data.type === "theme") { theme(data.theme); return; }
    if (data.type !== "result" && data.type !== "error") return;
    const call = pending.get(data.callId);
    if (!call) return;
    pending.delete(data.callId);
    if (data.type === "error") call.reject(new Error(data.error));
    else call.resolve(data);
  });

  function call(method, path, body) {
    const callId = nextCall++;
    return new Promise((resolve, reject) => {
      pending.set(callId, { resolve, reject });
      window.parent.postMessage({ channel: CHANNEL, type: "call", callId, method, path, body }, "*");
    });
  }

  document.getElementById("greet").addEventListener("click", async () => {
    const name = document.getElementById("name").value;
    try {
      const answer = await call("GET", "hello?name=" + encodeURIComponent(name));
      output.textContent = answer.body?.greeting ?? "No greeting";
      output.dataset.status = String(answer.status);
    } catch (error) {
      output.textContent = error.message;
      output.dataset.status = "error";
    }
  });

  async function reportTitle() {
    try {
      const answer = await call("GET", "hello?name=Ada");
      if (answer.body && typeof answer.body.greeting === "string") {
        window.parent.postMessage({ channel: CHANNEL, type: "title", value: answer.body.greeting }, "*");
      }
    } catch {
      // The bar keeps the extension's title when the call fails.
    }
  }

  new ResizeObserver(() => {
    window.parent.postMessage({ channel: CHANNEL, type: "height", value: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  }).observe(document.body);
  window.addEventListener("message", (event) => {
    if (event.source === window.parent && event.data && event.data.channel === CHANNEL && event.data.type === "init") void reportTitle();
  });
  window.parent.postMessage({ channel: CHANNEL, type: "ready" }, "*");
})();
