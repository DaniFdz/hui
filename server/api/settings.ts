/** Public HUI settings payloads, including browser and VS Code preferences. */
import { Type, type Static } from "typebox";
import { ThinkingLevel } from "./sessions.ts";

export const VscodeProviderPreference = Type.Union([
  Type.Literal("auto"), Type.Literal("configured"), Type.Literal("desktop"), Type.Literal("managed"), Type.Literal("path"),
], { $id: "VscodeProviderPreference" });
export type VscodeProviderPreference = Static<typeof VscodeProviderPreference>;

export const BrowserSettings = Type.Object({
  enabled: Type.Boolean(), headless: Type.Boolean(), executablePath: Type.String(), mirrorState: Type.Boolean(),
  /** Pages agents may reach; empty is anywhere. */
  allowedOrigins: Type.Array(Type.String()),
}, { $id: "BrowserSettings" });
export type BrowserSettings = Static<typeof BrowserSettings>;

export const VscodeSettings = Type.Object({
  enabled: Type.Boolean(), executable: Type.String(), provider: VscodeProviderPreference, licenseAcceptedAt: Type.String(),
}, { $id: "VscodeSettings" });
export type VscodeSettings = Static<typeof VscodeSettings>;

/** What a notification's tap opens: the gateway's own address in a browser, or one of the HUI apps. An app link
 * carries no address — `hui://open?path=/sessions/<id>` for the phone shell, `hui://sessions/<id>` for the desktop app —
 * so it opens on the gateway that app is already connected to, and a device without the app ignores the tap. */
export const NtfyLink = Type.Union([
  Type.Literal("web"), Type.Literal("phone"), Type.Literal("desktop"),
], { $id: "NtfyLink" });
export type NtfyLink = Static<typeof NtfyLink>;

/** The ntfy relay a phone or another device subscribes to. An empty topic means no relay; the server defaults to
 * `https://ntfy.sh`, and `HUI_NTFY_TOKEN` in the gateway's environment authenticates a protected topic without the
 * token ever entering settings or a payload. */
export const NtfySettings = Type.Object({
  server: Type.String(), topic: Type.String(), link: NtfyLink,
}, { $id: "NtfySettings" });
export type NtfySettings = Static<typeof NtfySettings>;

/** Web Push to this browser or a phone: off until the operator enables it on a device. `subject` is the VAPID `sub`
 * claim, a `mailto:` or `https:` contact address a push service may use for this gateway; empty omits the claim. The
 * gateway's private VAPID key never enters settings or a payload: it stays in `CONFIG_DIR/notifications/vapid.json`. */
export const PushSettings = Type.Object({
  enabled: Type.Boolean(), subject: Type.String(),
}, { $id: "PushSettings" });
export type PushSettings = Static<typeof PushSettings>;

/** HUI's default reasoning is one of PI's levels: Ultra is the orchestrating session's own choice. */
const SavedReasoningLevel = Type.Exclude(ThinkingLevel, Type.Literal("ultra"));

export const Settings = Type.Object({
  // A tool's own mark and icon stay on the gateway: the icon files live in its config directory, so every device
  // that draws a tool call reads them from the gateway that serves it. Appearance is not here: a theme, colour
  // mode, accent, typeface, text size or chat preference belongs to the device that shows it.
  chat: Type.Object({
    toolMarks: Type.Record(Type.String(), Type.String()),
    toolIcons: Type.Record(Type.String(), Type.String()),
  }),
  profileName: Type.String(), profileHandle: Type.String(),
  /** The operator's name for this gateway; empty means the machine's hostname, which `GET /__hui/health` reports. */
  name: Type.String(),
  branchPrefix: Type.String(),
  browser: BrowserSettings, codemode: Type.Object({ enabled: Type.Boolean() }), questions: Type.Object({ timeoutMinutes: Type.Number() }),
  vscode: VscodeSettings, power: Type.Object({ keepAwake: Type.Boolean() }),
  notifications: Type.Object({
    tool: Type.Boolean(), runFinished: Type.Boolean(), runFailed: Type.Boolean(), needsInput: Type.Boolean(),
    ntfy: NtfySettings,
    // Web Push: the device subscribes through the browser, and the gateway's VAPID key signs for it.
    push: PushSettings,
  }),
  models: Type.Object({
    primary: Type.String(), fallback: Type.String(), utility: Type.String(),
    // Empty follows PI's own defaultThinkingLevel.
    thinking: Type.Union([Type.Literal(""), SavedReasoningLevel]),
    retryAttempts: Type.Number(),
    routes: Type.Immutable(Type.Array(Type.Object({
      name: Type.String(), description: Type.String(), model: Type.String(),
      thinking: Type.Optional(SavedReasoningLevel),
    }))),
  }),
  calls: Type.Object({ voice: Type.Union([
    Type.Literal("cove"), Type.Literal("arbor"), Type.Literal("breeze"), Type.Literal("ember"), Type.Literal("juniper"),
    Type.Literal("maple"), Type.Literal("sol"), Type.Literal("spruce"), Type.Literal("vale"),
  ]) }),
  disabledSkills: Type.Immutable(Type.Array(Type.Object({ name: Type.String(), path: Type.String() }))),
  disabledPlugins: Type.Immutable(Type.Array(Type.Object({
    id: Type.String(), name: Type.String(), kind: Type.Union([Type.Literal("package"), Type.Literal("extension")]),
  }))),
  labs: Type.Object({ denseObservability: Type.Boolean(), detailedDebug: Type.Boolean() }),
}, { $id: "Settings" });
export type Settings = Static<typeof Settings>;

export const SettingsRequest = Type.Unknown({ $id: "SettingsRequest" });
export type SettingsRequest = Static<typeof SettingsRequest>;

export const SettingsError = Type.Object({ error: Type.String() }, { $id: "SettingsError" });
export type SettingsError = Static<typeof SettingsError>;

export const routeSchemas = [
  { method: "GET", path: "/__hui/settings", response: Settings },
  { method: "PUT", path: "/__hui/settings", request: SettingsRequest, response: Settings },
];
