/**
 * Spike S3 of docs/mobile-app-plan.md: the throwaway Capacitor config that proves `cap add ios` works on Linux.
 * The bundled Connect page is mobile/connect/dist; the iOS project is mobile/ios (Android is another worker's).
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.hui.app",
  appName: "HUI",
  webDir: "mobile/connect/dist",
  ios: { path: "mobile/ios" },
};

export default config;
