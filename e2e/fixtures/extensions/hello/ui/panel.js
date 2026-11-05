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
      window.parent.postMessage({ channel: CHANNEL, type: "call", callId, method, path, body }, location.origin);
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

  new ResizeObserver(() => {
    window.parent.postMessage({ channel: CHANNEL, type: "height", value: document.documentElement.scrollHeight }, location.origin);
  }).observe(document.body);
  window.parent.postMessage({ channel: CHANNEL, type: "ready" }, location.origin);
})();
