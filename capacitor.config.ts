import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Spike S1: the shell's Capacitor config. The bundled Connect page is the only local web content; the gateway's own UI
 * is loaded from the URL the user (or `--es huiGatewayUrl`) picks at runtime.
 */
const config: CapacitorConfig = {
  appId: "dev.hui.app",
  appName: "HUI",
  webDir: "mobile/connect/dist",
  android: {
    path: "mobile/android",
  },
  server: {
    androidScheme: "https",
    // Spike only: the fixture gateway is plain http on 127.0.0.1 through `adb reverse`.
    cleartext: true,
  },
};

export default config;
