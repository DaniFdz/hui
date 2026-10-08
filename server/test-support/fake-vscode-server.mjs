#!/usr/bin/env node
/**
 * A stand-in openvscode-server for the VS Code view's tests: the same CLI surface HUI launches (--help banner and
 * flags, --host/--port, --connection-token-file, --server-base-path), the token check on HTTP and WebSocket
 * upgrades, a workbench page with VS Code's configuration meta tag, an echo route and an echoing WebSocket.
 * FAKE_VSCODE_HELP replaces the --help text, FAKE_VSCODE_FAIL makes a start fail, FAKE_VSCODE_ARGS_FILE records its pid
 * and argv. Tests run it behind a launcher script that does not exec, like the real openvscode-server.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write(process.env.FAKE_VSCODE_HELP ?? [
    "OpenVSCode Server 9.8.7", "", "Usage: openvscode-server [options]", "",
    "  --host <ip-address>", "  --port <port>", "  --server-base-path <path>", "  --connection-token-file <path>",
    "  --server-data-dir", "  --user-data-dir <dir>", "  --extensions-dir <dir>", "",
  ].join("\n"));
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

const server = createServer((request, response) => {
  const url = new URL(request.url, "http://fake");
  if (url.pathname === `${base}/version`) { response.writeHead(200, { "content-type": "text/plain" }).end("fake-commit"); return; }
  if (tokenOf(request) !== token) { response.writeHead(403, { "content-type": "text/plain" }).end("Forbidden."); return; }
  if (url.pathname === `${base}/` || url.pathname === base) {
    const settings = { remoteAuthority: request.headers.host, serverBasePath: base, enableWorkspaceTrust: true, productConfiguration: {} };
    const attribute = JSON.stringify(settings).replace(/"/g, "&quot;");
    response.writeHead(200, { "content-type": "text/html", "set-cookie": [`vscode-tkn=${token}; Max-Age=604800; SameSite=Lax`, "vscode.other=1; Path=/"] });
    response.end(`<!DOCTYPE html><html><head><meta id="vscode-workbench-web-configuration" data-settings="${attribute}"></head><body>fake workbench for ${url.searchParams.get("folder")}</body></html>`);
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
  process.stdout.write(`Extension host agent listening on ${server.address().port}\n`);
});
