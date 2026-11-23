/**
 * A second gateway for the shared suite's gateway-list tests: a tiny HTTP server that answers the one handshake the page
 * probes (`GET /__hui/update` with `x-hui: 1`, and the preflight a browser sends first) with the name it was started
 * with, and nothing else. It is not HUI — it decides nothing a user sees beyond the name a probe reads — so a test that
 * proves switching navigates uses the same gateway at another origin instead. Stopping it is how a saved gateway
 * becomes one this page cannot reach, and starting it again is how Retry finds it.
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";

export type GatewayStub = {
  /** The address to type into the add field, without a trailing slash. */
  url: string;
  stop(): Promise<void>;
  start(): Promise<void>;
};

export async function startGatewayStub(name: string): Promise<GatewayStub> {
  let port = 0;
  const server = (): Server => createServer((request, response) => {
    const cors = { "access-control-allow-origin": "*", vary: "origin" };
    if (request.method === "OPTIONS") {
      response.writeHead(204, { ...cors, "access-control-allow-methods": "GET", "access-control-allow-headers": "x-hui", "access-control-max-age": "600" });
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/__hui/update" && request.headers["x-hui"] === "1") {
      response.writeHead(200, { ...cors, "content-type": "application/json", "cache-control": "no-store" });
      // The same handshake HUI answers: a version (null in a development checkout), a job and its own name.
      response.end(JSON.stringify({ name, currentVersion: null, check: null, job: null }));
      return;
    }
    // There is deliberately no /__hui/health here: the name a test sees came from the probe, not from a second route.
    response.writeHead(404, { ...cors, "content-type": "application/json" });
    response.end(JSON.stringify({ error: "the gateway stub serves only the identity handshake" }));
  });

  let listening: Server | null = server();
  listening.listen(port, "127.0.0.1");
  await once(listening, "listening");
  const address = listening.address();
  if (!address || typeof address === "string") throw new Error("the gateway stub did not take a port");
  port = address.port;

  return {
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      const closing = listening;
      listening = null;
      if (!closing) return;
      await new Promise<void>((resolve) => {
        closing.closeAllConnections();
        closing.close(() => resolve());
      });
    },
    start: async () => {
      if (listening) return;
      listening = server();
      listening.listen(port, "127.0.0.1");
      await once(listening, "listening");
    },
  };
}
