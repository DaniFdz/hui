#!/usr/bin/env node
/** Relays an isolated HUI fixture while its first selected-session open stalls after headers, or arrives in six
 * chunks over fifty seconds. Browser checks use the local stats to observe cancellation without changing app state.
 * Usage: node e2e/fixtures/session-load-proxy.mjs http://127.0.0.1:<fixture-port> <session-id> [stall|progress] */
import { createServer, request } from "node:http";
import { createConnection } from "node:net";

const [address, sessionId, mode = "stall"] = process.argv.slice(2);
const target = new URL(address);
if (target.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(target.hostname) || !target.port
  || target.username || target.password || !sessionId || !["stall", "progress"].includes(mode)) {
  throw new Error("Use a loopback HUI fixture URL, a session id, and stall or progress.");
}
const path = `/__hui/sessions/${encodeURIComponent(sessionId)}/open`;
const stats = { matchingOpens: 0, abandoned: 0, abandonedAfterMs: null, bytes: 0 };
const server = createServer((incoming, outgoing) => {
  if (incoming.url === "/__load-probe/stats") {
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify(stats));
    return;
  }
  const selected = incoming.method === "POST" && incoming.url === path && ++stats.matchingOpens === 1;
  const started = performance.now();
  let timer;
  let upstreamDone = false;
  const upstream = request({
    hostname: target.hostname, port: target.port, method: incoming.method, path: incoming.url,
    headers: { ...incoming.headers, ...(selected ? { "accept-encoding": "identity" } : {}) },
  }, (reply) => {
    reply.once("end", () => { upstreamDone = true; });
    const headers = { ...reply.headers };
    if (selected) {
      delete headers["content-length"];
      delete headers["content-encoding"];
    }
    outgoing.writeHead(reply.statusCode ?? 502, headers);
    if (!selected) { reply.pipe(outgoing); return; }
    outgoing.flushHeaders();
    if (mode === "stall") {
      let sent = false;
      reply.on("data", (chunk) => {
        if (!sent) {
          const prefix = chunk.subarray(0, 64);
          outgoing.write(prefix);
          stats.bytes += prefix.length;
          sent = true;
        }
      });
      return;
    }
    const chunks = [];
    reply.on("data", (chunk) => chunks.push(chunk));
    reply.once("end", () => {
      const body = Buffer.concat(chunks);
      const size = Math.ceil(body.length / 6);
      let offset = 0;
      const send = () => {
        if (outgoing.destroyed) return;
        const chunk = body.subarray(offset, offset + size);
        outgoing.write(chunk);
        stats.bytes += chunk.length;
        offset += size;
        if (offset >= body.length) outgoing.end();
        else timer = setTimeout(send, 10_000);
      };
      send();
    });
  });
  upstream.on("error", () => {
    if (outgoing.headersSent) outgoing.destroy();
    else outgoing.writeHead(502).end();
  });
  outgoing.once("close", () => {
    clearTimeout(timer);
    if (selected && !outgoing.writableFinished) {
      stats.abandoned += 1;
      stats.abandonedAfterMs = Math.round(performance.now() - started);
    }
    if (!upstreamDone) upstream.destroy();
  });
  incoming.once("aborted", () => upstream.destroy());
  incoming.pipe(upstream);
});
server.on("upgrade", (incoming, socket, head) => {
  const upstream = createConnection({ host: target.hostname, port: Number(target.port) });
  upstream.once("connect", () => {
    const headers = incoming.rawHeaders.reduce((text, value, index) => text + (index % 2 ? `${value}\r\n` : `${value}: `), "");
    upstream.write(`${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n${headers}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.once("close", () => upstream.destroy());
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}`, mode, sessionId }));
});
