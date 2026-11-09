/**
 * Spike S3 only (docs/mobile-app-plan.md): a page served on the runner's loopback, so the app can be given a gateway
 * URL at runtime and the screenshot shows whether the WKWebView loaded it and whether Capacitor's bridge is present
 * on that origin. Green background means the bridge is on a remote origin; red means the page loaded without it.
 */
import { createServer } from "node:http";

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>HUI S3 runtime URL probe</title>
    <style>
      html, body { margin: 0; height: 100%; }
      body {
        display: grid;
        place-items: center;
        text-align: center;
        padding: 24px;
        box-sizing: border-box;
        font: 600 26px/1.35 system-ui, sans-serif;
        color: #fff;
      }
      #detail { font: 400 16px/1.4 ui-monospace, monospace; margin-top: 16px; word-break: break-all; }
    </style>
  </head>
  <body>
    <div>
      <div id="verdict">…</div>
      <div id="detail"></div>
    </div>
    <script>
      const bridge = window.Capacitor;
      const platform = bridge && typeof bridge.getPlatform === "function" ? bridge.getPlatform() : "none";
      const native = Boolean(bridge) && typeof bridge.isNativePlatform === "function" && bridge.isNativePlatform();
      let plugins = [];
      try {
        plugins = bridge && bridge.Plugins ? Object.keys(bridge.Plugins) : [];
      } catch (error) {
        plugins = ["<error>"];
      }
      // Green only when Capacitor's bridge is injected into this remote origin, which is what the shell needs.
      document.body.style.background = native ? "#0a7d33" : "#c81e1e";
      document.getElementById("verdict").textContent = native ? "RUNTIME URL + BRIDGE" : "RUNTIME URL, NO BRIDGE";
      document.getElementById("detail").textContent = \`platform=\${platform} plugins=[\${plugins.join(",")}] url=\${location.href}\`;
    </script>
  </body>
</html>
`;

const port = Number(process.env.S3_PROBE_PORT ?? 4173);
createServer((request, response) => {
  console.log(`probe request ${request.method} ${request.url}`);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(page);
}).listen(port, "127.0.0.1", () => console.log(`probe page on http://127.0.0.1:${port}/`));
