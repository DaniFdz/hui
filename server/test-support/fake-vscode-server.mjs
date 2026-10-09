#!/usr/bin/env node
/**
 * A stand-in VS Code server for the VS Code view's tests, in two shapes. As openvscode-server (the default): the CLI
 * surface HUI launches (--help banner and flags, --host/--port, --connection-token-file, --server-base-path), the
 * token check on HTTP and WebSocket upgrades, a workbench page with VS Code's configuration meta tag, an echo route
 * and an echoing WebSocket. As VS Code's `code` CLI (FAKE_VSCODE_KIND=code): `--version`, `--help` naming serve-web, and
 * `serve-web` with the real one's flags, its Path=/ cookies, a page without the connection token, and its first-start
 * download (202 from /version with "Downloading server: n/total" lines on stdout for FAKE_SERVE_WEB_DOWNLOAD_MS, or for
 * ever without progress with FAKE_SERVE_WEB_STALL).
 * FAKE_VSCODE_HELP replaces the --help text, FAKE_VSCODE_FAIL makes a start fail, FAKE_VSCODE_ARGS_FILE records its pid
 * and argv. Tests run it behind a launcher script that does not exec, like the real launchers.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const args = process.argv.slice(2);
const code = process.env.FAKE_VSCODE_KIND === "code";
const serveWeb = code && args[0] === "serve-web";
export const FAKE_COMMIT = "645f29cc3176500b4b5762ba887cf2a7f0ffdf2c";
if (code && args[0] === "--version") {
  process.stdout.write(`1.137.0\n${FAKE_COMMIT}\nx64\n`);
  process.exit(0);
}
if (serveWeb && args.includes("--help")) {
  process.stdout.write(process.env.FAKE_SERVE_WEB_HELP ?? [
    "Runs a local web version of Visual Studio Code", "", "Usage: code-tunnel serve-web [OPTIONS]", "", "Options:",
    "      --host <HOST>", "      --socket-path <SOCKET_PATH>", "      --port <PORT>", "      --connection-token <CONNECTION_TOKEN>",
    "      --connection-token-file <CONNECTION_TOKEN_FILE>", "      --without-connection-token", "      --accept-server-license-terms",
    "      --server-base-path <SERVER_BASE_PATH>", "      --server-data-dir <SERVER_DATA_DIR>", "      --disable-telemetry",
    "      --commit-id <COMMIT_ID>", "", "GLOBAL OPTIONS:", "      --cli-data-dir <CLI_DATA_DIR>", "      --log <level>", "",
  ].join("\n"));
  process.exit(0);
}
if (args.includes("--help")) {
  process.stdout.write(process.env.FAKE_VSCODE_HELP ?? (code
    ? ["Visual Studio Code 1.137.0", "", "Usage: code [options][paths...]", "", "Subcommands", "  serve-web  Run a server that displays the editor UI in browsers.", ""]
    : [
      "OpenVSCode Server 9.8.7", "", "Usage: openvscode-server [options]", "",
      "  --host <ip-address>", "  --port <port>", "  --server-base-path <path>", "  --connection-token-file <path>",
      "  --server-data-dir", "  --user-data-dir <dir>", "  --extensions-dir <dir>", "",
    ]).join("\n"));
  process.exit(0);
}
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
if (process.env.FAKE_VSCODE_ARGS_FILE) writeFileSync(process.env.FAKE_VSCODE_ARGS_FILE, JSON.stringify({ pid: process.pid, args }));
if (process.env.FAKE_VSCODE_FAIL) {
  process.stderr.write(`fake failure: ${process.env.FAKE_VSCODE_FAIL}\nFile not found: /opt/vscode/node_modules/vsda/rust/web/vsda.js\n`);
  process.exit(7);
}
const token = readFileSync(option("--connection-token-file"), "utf8").trim();
const base = option("--server-base-path") ?? "";
const tokenOf = (request) => (request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=")).find(([name]) => name === "vscode-tkn")?.[1];
const downloadMs = Number(process.env.FAKE_SERVE_WEB_DOWNLOAD_MS ?? 0);
const stall = Boolean(process.env.FAKE_SERVE_WEB_STALL);
let downloadStarted = 0;
const TOTAL = 233_510_790;
/** serve-web's first request starts the download; until it is done every page is its 202 notice. */
function downloading() {
  if (!serveWeb || (!downloadMs && !stall)) return false;
  if (!downloadStarted) {
    downloadStarted = Date.now();
    if (!stall) {
      const timer = setInterval(() => {
        const share = Math.min(1, (Date.now() - downloadStarted) / downloadMs);
        process.stdout.write(`[2026-10-09 08:43:45] trace Downloading server: ${Math.round(TOTAL * share)}/${TOTAL} (${Math.round(share * 100)}%)\n`);
        if (share >= 1) clearInterval(timer);
      }, 40);
    }
  }
  return stall || Date.now() - downloadStarted < downloadMs;
}
const serveWebCookies = ["vscode-secret-key-path=" + base + "/_vscode-cli/mint-key; SameSite=Strict; Path=/", "vscode-cli-secret-half=half; SameSite=Strict; HttpOnly; Max-Age=2592000; Path=/"];

const server = createServer((request, response) => {
  const url = new URL(request.url, "http://fake");
  if (serveWeb && downloading()) {
    response.writeHead(202, { "content-type": "text/html", "set-cookie": serveWebCookies });
    response.end("The latest version of the Visual Studio Code Server is downloading, please wait a moment...<script>setTimeout(()=>location.reload(),1500)</script>");
    return;
  }
  if (url.pathname === `${base}/version`) { response.writeHead(200, { "content-type": "text/plain" }).end(serveWeb ? FAKE_COMMIT : "fake-commit"); return; }
  if (tokenOf(request) !== token) { response.writeHead(403, { "content-type": "text/plain" }).end("Forbidden."); return; }
  if (url.pathname === `${base}/` || url.pathname === base) {
    const settings = serveWeb
      ? { remoteAuthority: request.headers.host, serverBasePath: base, enableWorkspaceTrust: true, productConfiguration: { extensionsGallery: { resourceUrlTemplate: `http://${request.headers.host}${base}/stable-${FAKE_COMMIT}/web-extension-resource/{publisher}/{name}` } } }
      : { remoteAuthority: request.headers.host, serverBasePath: base, enableWorkspaceTrust: true, productConfiguration: {} };
    const attribute = JSON.stringify(settings).replace(/"/g, "&quot;");
    response.writeHead(200, { "content-type": "text/html", "set-cookie": serveWeb ? [`vscode-tkn=${token}; Max-Age=604800; SameSite=Lax`, ...serveWebCookies] : [`vscode-tkn=${token}; Max-Age=604800; SameSite=Lax`, "vscode.other=1; Path=/"] });
    response.end(`<!DOCTYPE html><html><head><meta id="vscode-workbench-web-configuration" data-settings="${attribute}"></head><body>fake ${serveWeb ? "serve-web " : ""}workbench for ${url.searchParams.get("folder")}</body></html>`);
    return;
  }
  if (url.pathname.startsWith(`${base}/echo`)) {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json", "set-cookie": `vscode-tkn=${token}` });
      response.end(JSON.stringify({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" }).end("File not found");
});

const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  if (tokenOf(request) !== token) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  sockets.handleUpgrade(request, socket, head, (ws) => {
    ws.send(JSON.stringify({ type: "hello", url: request.url, host: request.headers.host, cookie: request.headers.cookie }));
    ws.on("message", (data) => ws.send(`echo:${data}`));
  });
});
server.listen(Number(option("--port")), option("--host") ?? "127.0.0.1", () => {
  process.stdout.write(serveWeb ? `Web UI available at http://127.0.0.1:${server.address().port}${base}?tkn=${token}\n` : `Extension host agent listening on ${server.address().port}\n`);
});
