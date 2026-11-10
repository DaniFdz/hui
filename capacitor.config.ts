/**
 * The phone shell's Capacitor config (WP1 of docs/mobile-app-plan.md). It bundles one page, the Connect page in
 * `mobile/connect`, and the app then loads the gateway the user connects to. The gateway address is not here: it is
 * chosen at runtime, and `mobile/android/app/src/main/java/dev/hui/app/MainActivity.java` builds the bridge with it as
 * the server URL so Capacitor's document-start script and plugins are scoped to the gateway's origin.
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.hui.app",
  appName: "HUI",
  // The build output of mobile/connect (git-ignored): the only web content the app ships.
  webDir: "mobile/connect/dist",
  android: {
    path: "mobile/android",
    // The Connect page's own background, so a reload never flashes white before the page paints.
    backgroundColor: "#101014",
    // WebView debugging follows the build type: on in the debug APK (dev.hui.app.debug), off in the release build.
    // Left unset on purpose, which is Capacitor's debuggable-build default; MainActivity keeps that default when it
    // rebuilds the config from this file, and mobile/AGENTS.md records the rule.
  },
  ios: {
    path: "mobile/ios",
  },
  plugins: {
    // The shell answers the system back button itself (mobile/android/.../ShellBack.java): it dispatches a cancelable
    // `hui:back` event to the page and, when the page does not keep it, walks the WebView's history and then leaves the
    // app on a second press. Capacitor's App plugin would otherwise also walk the history from its own callback, so its
    // handler is switched off and the ordering is explicit rather than a matter of which callback registered last.
    App: {
      disableBackButtonHandler: true,
    },
  },
  server: {
    // A real gateway needs https (default only for loopback and `10.0.2.2` tests, see the app's network security
    // config). Capacitor requires https for the bundled page's own origin.
    androidScheme: "https",
  },
};

export default config;
