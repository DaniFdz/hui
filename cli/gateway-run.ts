/** Child entry point for a detached gateway. The parent CLI sends the gateway options over IPC; this process starts the
 * gateway, reports readiness or the startup error back, then drops the channel and keeps serving on its own. */
import { runGateway, type GatewayOptions } from "../server/gateway.ts";

process.once("message", (options: GatewayOptions) => {
  void runGateway(options).then(({ state }) => {
    process.send?.({ ready: true, instance: state.instance });
    process.disconnect?.();
  }).catch((error: unknown) => {
    process.send?.({ error: error instanceof Error ? error.message : "Gateway startup failed." });
    process.disconnect?.(); process.exitCode = 1;
  });
});
