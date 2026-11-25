/**
 * `SettingsController` keeps the settings state outside `hui-app.ts`: this device's appearance and its synchronous
 * saves, the gateway's settings and their saves, the theme picker and imports, PI's configuration and its package
 * and skill changes, the resource reader, Web Push on this device (what this browser's permission allows now, its
 * subscription and the gateway's device count), and the control surfaces (gateway health, macOS power, the workspace
 * inspection and observability). Settings elements that load their own data keep their own requests.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { downloadDiagnostics, loadObservability, type ObservabilitySnapshot } from "../api/observability.ts";
import { installPiPackage, installPiSkill, loadPiConfig, loadPiResource, removePiPackage } from "../api/pi.ts";
import {
  loadGatewayHealth,
  loadPower,
  loadWorkspaceInspection,
  setLidAwake,
  type GatewayHealth,
  type WorkspaceInspection,
} from "../api/control-surfaces.ts";
import { writeClipboardText } from "../lib/clipboard.ts";
import { fetchPushStatus, sendPushTest, sendTestNotification, subscribePushDevice, unsubscribePushDevice } from "../api/notifications.ts";
import {
  currentSubscription,
  isStandalone,
  pushDeviceState,
  subscribeDevice,
  PUSH_SUBSCRIBE_ERRORS,
  type PushDeviceState,
  type PushEnvironment,
  type PushRegistrationLike,
  type PushSubscribeResult,
} from "../lib/notifications/web-push.ts";
import { describePushTest, SETTINGS_COPY } from "../lib/settings/pages.ts";
import { closeModal } from "../lib/modal-dialog.ts";
import type { HuiPage } from "../lib/pages.ts";
import { skillPreferencePath, type PiMutationKind, type PiMutationResult, type PiMutationState, type PiSnapshot } from "../lib/pi.ts";
import type { Settings } from "../lib/settings/settings.ts";
import { currentSettings, patchSettings, saveSubagentRoute } from "../lib/settings/settings-store.ts";
import { applyDeviceAppearance, normalizeDeviceAppearance, readAppearance, saveAppearance, type DeviceAppearance } from "../lib/appearance/store.ts";
import type { ThemeMode, ThemeVariant } from "../lib/theme/theme.ts";
import {
  applyAccent,
  applyMode,
  applyTheme,
  importTheme,
  loadThemePreviews,
  selectedThemeId,
  selectedThemeVariant,
  type ThemePreview,
} from "../lib/theme/theme-store.ts";
import type { PiResourceReaderState } from "../views/pi-resource-reader.ts";
import type { AutomationProps } from "../views/settings-automation.ts";
import type { SettingsProps } from "../views/settings.ts";
import type { PowerStatus } from "../api/schema/power.ts";

type SettingsHost = ReactiveControllerHost & { renderRoot: ParentNode };

type SettingsEvents = {
  piLoaded: (snapshot: PiSnapshot) => void;
  copyFailed: (message: string) => void;
  /** An outcome the operator should see, such as the ntfy test notification's result. */
  notified: (message: string, failed: boolean) => void;
};

/**
 * This page as Web Push sees it: the facts about the browser, its registered service worker, the permission prompt and
 * its push manager. Injectable so a test drives every outcome without a browser, and the raw browser errors never
 * leave the pure helpers in `lib/notifications/web-push.ts`.
 */
export type PushBrowser = {
  /** What this browser can do, read when the page loads and again whenever the page learns it may have changed. */
  environment(): PushEnvironment;
  /** The service worker registration this page already has, or nothing while it has none. */
  registration(): Promise<PushRegistrationLike | undefined>;
  /** Asks for permission when the browser still may, and answers what it then says. */
  permission(): Promise<NotificationPermission>;
  /** This page's existing subscription endpoint, for the button's state after a reload. */
  subscription(registration: PushRegistrationLike | undefined): Promise<string | undefined>;
  /** Subscribes this page with the gateway's public key, refusing in a sentence rather than a browser error. */
  subscribe(registration: PushRegistrationLike | undefined, applicationServerKey: string): Promise<PushSubscribeResult>;
  /** Forgets this page's subscription at its push service, and says whether the browser had one. */
  unsubscribe(registration: PushRegistrationLike | undefined): Promise<boolean>;
};

/** This browser's push environment, as the page reports it: no `PushManager`, an insecure address, a notification
 * permission the operator blocked, or Safari's Home Screen requirement on iPhone and iPad. */
function readPushEnvironment(): PushEnvironment {
  const page = typeof window === "undefined" ? undefined : window;
  const agent: { userAgent?: string; platform?: string; maxTouchPoints?: number; standalone?: boolean } =
    typeof navigator === "undefined" ? {} : navigator;
  // A page that has no `matchMedia` is not an installed app; guarding the window alone would still call `.bind` on
  // nothing. `isStandalone` already answers "no" for an absent source.
  const matchMedia = typeof page?.matchMedia === "function" ? page.matchMedia.bind(page) : undefined;
  return {
    secure: page?.isSecureContext === true,
    pushManager: typeof page?.PushManager !== "undefined",
    userAgent: agent.userAgent ?? "",
    platform: agent.platform,
    maxTouchPoints: agent.maxTouchPoints,
    standalone: isStandalone({ matchMedia, navigator: agent }),
    // Read, never asked: a prompt belongs to the click that needs one, not to drawing the page.
    permission: typeof Notification === "undefined" ? undefined : Notification.permission,
  };
}

/** The real browser behind the push actions. Every call guards the globals it reads, so a page that has no service
 * worker answers "nothing" instead of throwing. */
function browserPush(): PushBrowser {
  const serviceWorker = () => (typeof navigator === "undefined" ? undefined : navigator.serviceWorker);
  const registration = async (): Promise<PushRegistrationLike | undefined> => {
    const worker = serviceWorker();
    if (!worker) return undefined;
    const existing = await worker.getRegistration().catch(() => undefined);
    if (existing?.active) return { pushManager: existing.pushManager };
    if (!existing) return undefined;
    // A worker that is still installing activates on its own: `ready` waits for it instead of failing a click that
    // would have worked a moment later.
    const activated = await worker.ready.catch(() => undefined);
    return activated?.active ? { pushManager: activated.pushManager } : undefined;
  };
  return {
    environment: readPushEnvironment,
    registration,
    async permission() {
      if (typeof Notification === "undefined") return "denied";
      return Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    },
    subscription: (ready) => currentSubscription(ready),
    subscribe: (ready, applicationServerKey) => subscribeDevice({
      applicationServerKey,
      registration: ready,
      secure: typeof window !== "undefined" && window.isSecureContext,
    }),
    async unsubscribe(ready) {
      const subscription = await ready?.pushManager.getSubscription().catch(() => null);
      if (!subscription?.unsubscribe) return false;
      return subscription.unsubscribe().catch(() => false);
    },
  };
}

export class SettingsController implements ReactiveController {
  settings: Settings = currentSettings();
  /** This device's theme, accent, typefaces, text size and chat preferences; saved here, never through the gateway. */
  appearance: DeviceAppearance = readAppearance();
  saveFailed = false;
  /** A device store the browser refused to write: the choice applies now and is gone after a reload. */
  appearanceSaveFailed = false;
  themeId: string = selectedThemeId();
  variant: ThemeVariant = selectedThemeVariant();
  previews: readonly ThemePreview[] = [];
  themeImportNote = "";
  themeImportFailed = false;
  #previewsLoad: Promise<unknown> | undefined;
  /** `undefined` until the backend answers, so an empty list never reads as "none". */
  pi: PiSnapshot | undefined;
  piLoading = false;
  piError = "";
  piOperation: PiMutationState | undefined;
  piRemoveCandidate = "";
  piResourceReader: PiResourceReaderState | undefined;
  health: GatewayHealth | undefined;
  healthError = "";
  /** macOS sleep prevention; `null` when the gateway is not on macOS. */
  power: PowerStatus | null | undefined;
  powerNoticeDismissed = false;
  workspaceInspection: WorkspaceInspection | undefined;
  workspaceError = "";
  controlLoading = false;
  observability: ObservabilitySnapshot | undefined;
  observabilityLoading = false;
  observabilityError = "";
  /** What this browser can do about Web Push. The page re-reads it after every push action, because a permission the
   * operator just granted or blocked changes it while the page stays open. */
  pushDevice: PushDeviceState;
  /** Whether this device already subscribed, so Settings offers the other direction after a reload. */
  pushSubscribed = false;
  /** How many devices this gateway pushes to; `undefined` until it answers. */
  pushDevices: number | undefined;
  pushStatusError = "";
  readonly #host: SettingsHost;
  readonly #events: SettingsEvents;
  readonly #push: PushBrowser;
  /** The endpoint this page subscribed, remembered even after the browser forgot it, so a device the gateway still
   * holds can be removed from the page that put it there. */
  #pushEndpoint: string | undefined;
  #saveRevision = 0;
  #pushStatus: Promise<void> | undefined;
  #healthPending = false;
  #powerRequest = 0;
  #powerPoll: Promise<void> | undefined;
  #piRequest: Promise<void> | undefined;
  #readerReturnFocus: HTMLElement | undefined;
  #readerRequest = 0;
  #copyTimer: number | undefined;

  constructor(host: SettingsHost, events: SettingsEvents, push: PushBrowser = browserPush()) {
    this.#host = host;
    this.#events = events;
    this.#push = push;
    this.pushDevice = pushDeviceState(push.environment());
    host.addController(this);
  }

  hostDisconnected(): void {
    this.#clearCopyTimer();
  }

  #changed(): void {
    this.#host.requestUpdate();
  }

  async save(patch: Partial<Settings>) {
    const revision = ++this.#saveRevision;
    const pending = patchSettings(patch);
    // Render the store's optimistic snapshot before another control builds a
    // nested patch. Waiting for disk here reintroduced stale Labs/Chat values.
    this.settings = currentSettings();
    this.#changed();
    const saved = await pending;
    if (revision !== this.#saveRevision) return;
    this.saveFailed = !saved;
    this.settings = currentSettings();
    this.#changed();
  }

  /**
   * Saves the ntfy relay that Settings → Notifications → Phone (ntfy) edits. The topic is what the phone subscribes to,
   * so a save that does not land must not be followed by a test that reports the old one.
   */
  saveNtfy = async (ntfy: Settings["notifications"]["ntfy"]): Promise<boolean> => {
    const revision = ++this.#saveRevision;
    const saved = await patchSettings({ notifications: { ...this.settings.notifications, ntfy } });
    if (revision !== this.#saveRevision) return saved;
    this.saveFailed = !saved;
    this.settings = currentSettings();
    this.#changed();
    return saved;
  };

  /** Publishes one test message to the saved topic, then says where it went. */
  testNtfyNotification = async (ntfy: Settings["notifications"]["ntfy"]): Promise<void> => {
    if (!(await this.saveNtfy(ntfy))) {
      this.#events.notified("Could not save the notification settings.", true);
      return;
    }
    if (!this.settings.notifications.ntfy.topic) {
      this.#events.notified("Set an ntfy topic first.", true);
      return;
    }
    try {
      await sendTestNotification();
      this.#events.notified("Test notification sent. Check the ntfy app on your phone.", false);
    } catch (error) {
      this.#events.notified(error instanceof Error ? error.message : "The test notification failed.", true);
    }
  };

  copyNtfyAddress = (): void => {
    const { server, topic } = this.settings.notifications.ntfy;
    if (!topic) {
      this.#events.notified("Set an ntfy topic first.", true);
      return;
    }
    void writeClipboardText(`${server}/${topic}`).then((copied) => {
      if (!copied) {
        this.#events.copyFailed("Could not copy the ntfy address to the clipboard.");
        return;
      }
      this.#events.notified("Copied the ntfy address.", false);
    });
  };

  /** Reads this gateway's push state and this page's own subscription: the count and the button's direction. */
  loadPushStatus = (): void => {
    if (this.#pushStatus) return;
    this.pushStatusError = "";
    this.#pushStatus = this.#readPushStatus().finally(() => { this.#pushStatus = undefined; });
  };

  async #readPushStatus(): Promise<void> {
    try {
      const [status, ready] = await Promise.all([fetchPushStatus(), this.#pushRegistration()]);
      this.pushDevices = status.devices.length;
      const endpoint = await this.#push.subscription(ready);
      if (endpoint) this.#pushEndpoint = endpoint;
      this.pushSubscribed = Boolean(endpoint);
      this.pushStatusError = "";
    } catch (error) {
      this.pushStatusError = error instanceof Error ? error.message : "Could not read this gateway's push state.";
    } finally {
      this.#changed();
    }
  }

  #pushRegistration(): Promise<PushRegistrationLike | undefined> {
    return this.#push.registration().catch(() => undefined);
  }

  /**
   * Reads the browser's push environment again and takes the state it decides, never a guess from an error a click got:
   * a permission prompt the operator just answered `Notification.permission` for, and only a changed answer redraws.
   */
  #syncPushDevice(): void {
    const device = pushDeviceState(this.#push.environment());
    if (device === this.pushDevice) return;
    this.pushDevice = device;
    this.#changed();
  }

  /** The sentence for a page that cannot subscribe at all, so no button has to lie about why. */
  #pushUnavailable(): string {
    return SETTINGS_COPY.push.states[this.pushDevice === "ready" ? "ready" : this.pushDevice];
  }

  /** Saves the push switch against the rest of the notifications settings, so a concurrent edit is kept. */
  async #savePushEnabled(enabled: boolean): Promise<boolean> {
    const revision = ++this.#saveRevision;
    const saved = await patchSettings({
      notifications: { ...this.settings.notifications, push: { ...this.settings.notifications.push, enabled } },
    });
    if (revision === this.#saveRevision) {
      this.saveFailed = !saved;
      this.settings = currentSettings();
      this.#changed();
    }
    return saved;
  }

  /**
   * Subscribes this browser and turns Web Push on: the gateway's public key, the browser's push service, one registered
   * subscription, then the switch. A refused permission or a browser without a push service is a sentence, never a
   * thrown browser error.
   */
  enablePushOnThisDevice = async (): Promise<void> => {
    if (this.pushDevice !== "ready") {
      this.#events.notified(this.#pushUnavailable(), true);
      return;
    }
    try {
      // What the gateway says and what this page has come first: a permission prompt nobody could honour is a defect.
      const { publicKey } = await fetchPushStatus();
      const ready = await this.#pushRegistration();
      if (!ready) {
        this.#events.notified(PUSH_SUBSCRIBE_ERRORS["no-service-worker"], true);
        return;
      }
      const permission = await this.#push.permission();
      if (permission !== "granted") {
        this.#events.notified(PUSH_SUBSCRIBE_ERRORS["permission-denied"], true);
        return;
      }
      const subscribed = await this.#push.subscribe(ready, publicKey);
      if (!subscribed.ok) {
        this.#events.notified(subscribed.error, true);
        return;
      }
      this.#pushEndpoint = subscribed.endpoint;
      const device = this.#deviceLabel();
      await subscribePushDevice({
        endpoint: subscribed.endpoint,
        keys: { p256dh: subscribed.p256dh, auth: subscribed.auth },
        ...(device ? { device } : {}),
      });
      const saved = await this.#savePushEnabled(true);
      this.pushSubscribed = true;
      this.#changed();
      this.#events.notified(saved ? SETTINGS_COPY.push.enabled : "This device is subscribed, but the switch could not be saved.", !saved);
      this.loadPushStatus();
    } catch (error) {
      this.#events.notified(error instanceof Error ? error.message : "Could not enable Web Push on this device.", true);
    } finally {
      // The prompt, its refusal and the subscription all happen after this page read the environment: a browser the
      // operator has just blocked says `blocked` here rather than after a reload, and one that refused for another
      // reason keeps the permission it has.
      this.#syncPushDevice();
    }
  };

  /**
   * Forgets this device at the gateway and at its push service, then turns the switch off. The gateway is asked first:
   * a browser that forgot its subscription first would leave the device in the count with no address left to remove it
   * by, and a retry would only turn the switch off. A failed removal keeps the remembered endpoint, so the retry
   * finishes the job.
   */
  disablePushOnThisDevice = async (): Promise<void> => {
    const ready = await this.#pushRegistration();
    const endpoint = this.#pushEndpoint ?? await this.#push.subscription(ready).catch(() => undefined);
    if (!endpoint) {
      await this.#savePushEnabled(false);
      this.pushSubscribed = false;
      this.#changed();
      this.#events.notified(SETTINGS_COPY.push.nothingToRemove, false);
      return;
    }
    // Remembered before the gateway is asked, so a removal that fails still has an address to retry with.
    this.#pushEndpoint = endpoint;
    try {
      await unsubscribePushDevice(endpoint);
    } catch (error) {
      this.#events.notified(error instanceof Error ? error.message : "Could not remove this device from the gateway.", true);
      this.loadPushStatus();
      return;
    }
    this.#pushEndpoint = undefined;
    // The gateway no longer pushes to it, so the switch goes off either way; a browser that kept its subscription is said
    // out loud rather than hidden behind a switch that looks finished.
    const gone = await this.#push.unsubscribe(ready).catch(() => false);
    // Asked before the switch is written: a disable the browser refused may be the sign its permission changed.
    this.#syncPushDevice();
    const saved = await this.#savePushEnabled(false);
    this.pushSubscribed = false;
    this.#changed();
    if (!gone) this.#events.notified(SETTINGS_COPY.push.browserKept, true);
    else this.#events.notified(saved ? SETTINGS_COPY.push.disabled : "This device is forgotten, but the switch could not be saved.", !saved);
    this.loadPushStatus();
  };

  /** Publishes one test push and reports the counts the gateway answered with, never a promise it cannot keep. */
  testPushNotification = async (): Promise<void> => {
    try {
      const { sent, devices } = await sendPushTest();
      this.pushDevices = devices;
      this.#changed();
      this.#events.notified(describePushTest(sent, devices), devices === 0 || sent !== devices);
    } catch (error) {
      this.#events.notified(error instanceof Error ? error.message : "The test push failed.", true);
    }
  };

  /** What the device list may call this browser: its platform, never a capability or an address. */
  #deviceLabel(): string | undefined {
    const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    const known: [RegExp, string][] = [
      [/iPhone/u, "iPhone"], [/iPad/u, "iPad"], [/Android/u, "Android"],
      [/Macintosh|Mac OS X/u, "Mac"], [/Windows/u, "Windows"], [/Linux/u, "Linux"],
    ];
    return known.find(([pattern]) => pattern.test(agent))?.[1];
  }

  saveSubagentRoute = async (route: Settings["models"]["routes"][number], originalName?: string): Promise<boolean> => {
    const revision = ++this.#saveRevision;
    const saved = await saveSubagentRoute(route, originalName);    if (revision === this.#saveRevision) this.saveFailed = !saved;
    this.settings = currentSettings();
    this.#changed();
    return saved;
  };

  /**
   * Saves the name this gateway reports to every client, then reads health again so the gateway list and About show
   * it now rather than at the next poll. Resolves false when the write did not land.
   */
  saveGatewayName = async (name: string): Promise<boolean> => {
    const revision = ++this.#saveRevision;
    const saved = await patchSettings({ name });
    if (revision === this.#saveRevision) {
      this.saveFailed = !saved;
      this.settings = currentSettings();
      this.#changed();
    }
    if (saved) await this.refreshGatewayHealth();
    return saved;
  };

  patchOwnedSettings = (patch: Partial<Settings>) => {
    void this.save(patch);
  };

  /** Reads every theme file once: a second visit to the picker, or one made
   * while the first read is still running, reuses it. */
  loadPreviews(): void {
    if (this.previews.length) return;
    const pending = this.#previewsLoad ??= loadThemePreviews().then((previews) => {
      if (this.#previewsLoad !== pending) return;
      this.#previewsLoad = undefined;
      this.previews = previews;
      this.#changed();
    });
  }

  /**
   * Saves this device's appearance and applies it at once. Unlike `save`, nothing leaves the page: no request, no
   * gateway round-trip, and no waiting to hear that it landed. A storage that refuses the write still applies the
   * change, so the page shows what it is using and the note says the next load forgets it.
   */
  saveAppearance = (patch: Partial<DeviceAppearance>) => {
    const saved = saveAppearance(patch);
    this.appearanceSaveFailed = saved === undefined;
    this.appearance = saved ?? normalizeDeviceAppearance({ ...this.appearance, ...patch });
    applyDeviceAppearance(this.appearance);
    this.#changed();
  };

  chooseMode = (mode: ThemeMode) => {
    applyMode(mode);
    this.saveAppearance({ themeMode: mode });
  };

  chooseTheme = (id: string) => {
    void this.#applyTheme(id);
  };

  chooseAccent = (accent: string) => {
    applyAccent(accent);
    this.saveAppearance({ accent });
  };

  async #applyTheme(id: string) {
    // Read the selection back rather than assuming it: a theme whose file fails
    // to load is not applied, and the picker has to snap back to the old one.
    const variant = await applyTheme(id);
    this.themeId = selectedThemeId();
    this.variant = variant ?? this.variant;
    this.#changed();
    if (variant) this.saveAppearance({ theme: selectedThemeId() });
  }

  importTheme = (url: string) => {
    this.themeImportNote = "Importing…";
    this.themeImportFailed = false;
    this.#changed();
    void importTheme(url)
      .then(async (id) => {
        this.#previewsLoad = undefined;
        this.previews = await loadThemePreviews();
        this.themeImportNote = `Imported ${id}.`;
        this.themeImportFailed = false;
        this.#changed();
        await this.#applyTheme(id);
      })
      .catch((error: unknown) => {
        this.themeImportNote = error instanceof Error ? error.message : "Import failed.";
        this.themeImportFailed = true;
        this.#changed();
      });
  };

  async refreshGatewayHealth() {
    if (this.#healthPending || this.controlLoading) return;
    this.#healthPending = true;
    try {
      this.health = await loadGatewayHealth();
      this.healthError = "";
    } catch (error) {
      this.healthError = error instanceof Error ? error.message : "Could not read gateway health.";
    } finally {
      this.#healthPending = false;
      this.#changed();
    }
  }

  /** The newest request wins, so an older poll never undoes a click. */
  async refreshPower(next?: Promise<PowerStatus | null>) {
    const request = ++this.#powerRequest;
    let power: PowerStatus | null | undefined;
    try {
      power = await (next ?? loadPower());
    } catch {
      // Unknown rather than stale: no banner or switches until the gateway answers.
    }
    if (request !== this.#powerRequest) return;
    const dismissed = this.powerNoticeDismissed && Boolean(power?.lidOn);
    if (JSON.stringify(power) === JSON.stringify(this.power) && dismissed === this.powerNoticeDismissed) return;
    this.power = power;
    this.powerNoticeDismissed = dismissed;
    this.#changed();
  }

  pollPower(): void {
    this.#powerPoll ??= this.refreshPower().finally(() => { this.#powerPoll = undefined; });
  }

  setLidAwake = (on: boolean) => void this.refreshPower(setLidAwake(on));

  dismissPowerNotice(): void {
    this.powerNoticeDismissed = true;
    this.#changed();
  }

  loadStale(): void {
    const stale = Boolean(this.piError || this.healthError || this.workspaceError);
    if (stale || !this.pi || !this.health || !this.workspaceInspection) {
      this.loadControlSurfaceData(stale);
    }
  }

  loadControlSurfaceData = (force = false) => {
    if (this.controlLoading) return;
    if (!force && this.pi && this.health && this.workspaceInspection) return;
    this.controlLoading = true;
    this.piLoading = true;
    this.piError = "";
    this.healthError = "";
    this.workspaceError = "";
    this.#changed();
    void Promise.allSettled([loadPiConfig(), loadGatewayHealth(), loadWorkspaceInspection()])
      .then(([pi, health, workspaces]) => {
        const message = (reason: unknown, fallback: string) =>
          reason instanceof Error ? reason.message : fallback;
        if (pi.status === "fulfilled") {
          this.pi = pi.value;
          this.#events.piLoaded(pi.value);
        }
        else this.piError = message(pi.reason, "Could not read PI configuration.");
        if (health.status === "fulfilled") this.health = health.value;
        else this.healthError = message(health.reason, "Could not read gateway health.");
        if (workspaces.status === "fulfilled") this.workspaceInspection = workspaces.value;
        else this.workspaceError = message(workspaces.reason, "Could not inspect workspaces.");
      })
      .finally(() => {
        this.controlLoading = false;
        this.piLoading = false;
        this.#changed();
      });
  };

  loadPi(): void {
    if (this.#piRequest) return;
    this.piLoading = true;
    this.#changed();
    this.#piRequest = loadPiConfig()
      .then((snapshot) => {
        this.pi = snapshot;
        this.piError = "";
        this.#events.piLoaded(snapshot);
      })
      .catch((error: unknown) => {
        this.piError = error instanceof Error ? error.message : "Could not read PI configuration.";
      })
      .finally(() => {
        this.piLoading = false;
        this.#piRequest = undefined;
        this.#changed();
      });
  }

  #runPiMutation(
    kind: PiMutationKind,
    target: string,
    operation: () => Promise<PiMutationResult>,
  ) {
    if (this.piOperation?.status === "running") return;
    this.piOperation = { kind, target, status: "running", message: kind === "skill-install" ? "The installer agent is inspecting the skill source." : "PI is updating its package configuration." };
    this.#changed();
    void operation()
      .then((result) => {
        this.pi = result.snapshot;
        this.piOperation = { kind, target: result.target, status: "ok", message: result.message };
        this.piRemoveCandidate = "";
      })
      .catch((error: unknown) => {
        this.piOperation = {
          kind,
          target,
          status: "error",
          message: error instanceof Error ? error.message : "PI operation failed.",
        };
      })
      .finally(() => this.#changed());
  }

  installPiPackage = (url: string) => {
    this.#runPiMutation("package-install", url, () => installPiPackage(url));
  };

  requestPiPackageRemoval = (source: string) => {
    this.piRemoveCandidate = source;
    this.#changed();
  };

  cancelPiPackageRemoval = () => {
    this.piRemoveCandidate = "";
    this.#changed();
  };

  removePiPackage = (source: string) => {
    this.#runPiMutation("package-remove", source, () => removePiPackage(source));
  };

  installPiSkill = (url: string) => {
    this.#runPiMutation("skill-install", url, () => installPiSkill(url));
  };

  setPiSkillEnabled = (skill: PiSnapshot["skills"][number], enabled: boolean) => {
    const disabledSkills = this.settings.disabledSkills.filter((entry) => entry.path !== skillPreferencePath(skill) && entry.path !== skill.path);
    if (!enabled) disabledSkills.push({ name: skill.name, path: skillPreferencePath(skill) });
    void this.save({ disabledSkills });
  };

  setPiPluginEnabled = (resource: PiSnapshot["settings"]["resources"][number], enabled: boolean) => {
    const disabledPlugins = this.settings.disabledPlugins.filter((entry) => entry.id !== resource.id);
    if (!enabled) disabledPlugins.push({ id: resource.id, name: resource.label, kind: resource.kind });
    void this.save({ disabledPlugins });
  };

  #clearCopyTimer(): void {
    if (this.#copyTimer !== undefined) window.clearTimeout(this.#copyTimer);
    this.#copyTimer = undefined;
  }

  readPiResource = (kind: "skill" | "plugin", resource: { id: string; name?: string; label?: string }) => {
    const title = resource.name ?? resource.label ?? "PI resource";
    const request = ++this.#readerRequest;
    this.#clearCopyTimer();
    this.#readerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.piResourceReader = { title, status: "loading" };
    this.#changed();
    void loadPiResource(kind, resource.id).then(
      (document) => {
        if (request !== this.#readerRequest) return;
        this.piResourceReader = { title, status: "ready", document };
        this.#changed();
      },
      (error: unknown) => {
        if (request !== this.#readerRequest) return;
        this.piResourceReader = { title, status: "error", error: error instanceof Error ? error.message : "Could not read this resource." };
        this.#changed();
      },
    );
  };

  copyPiResource = () => {
    const reader = this.piResourceReader;
    if (!reader?.document) return;
    const resourceId = reader.document.id;
    void writeClipboardText(reader.document.content).then((copied) => {
      if (!copied) throw new Error("Clipboard write failed");
      if (this.piResourceReader !== reader) return;
      this.piResourceReader = { ...reader, copied: true };
      this.#changed();
      this.#clearCopyTimer();
      this.#copyTimer = window.setTimeout(() => {
        const current = this.piResourceReader;
        if (current && current.document?.id === resourceId) {
          this.piResourceReader = { ...current, copied: false };
          this.#changed();
        }
      }, 1_500);
    }).catch(() => {
      this.#events.copyFailed("Could not copy the resource to the clipboard.");
    });
  };

  closePiResourceReader = () => {
    this.#readerRequest += 1;
    this.#clearCopyTimer();
    closeModal(this.#host.renderRoot.querySelector<HTMLDialogElement>(".pi-resource-reader-modal") ?? undefined);
    this.piResourceReader = undefined;
    this.#changed();
    const target = this.#readerReturnFocus;
    this.#readerReturnFocus = undefined;
    target?.focus();
  };

  loadObservability(force: boolean): void {
    if (!force && this.observability) return;
    this.observabilityLoading = true;
    this.observabilityError = "";
    this.#changed();
    void loadObservability()
      .then((snapshot) => { this.observability = snapshot; })
      .catch((error: unknown) => { this.observabilityError = error instanceof Error ? error.message : "Could not read observability state."; })
      .finally(() => {
        this.observabilityLoading = false;
        this.#changed();
      });
  }

  exportDiagnostics = () => {
    void downloadDiagnostics().catch((error: unknown) => {
      this.observabilityError = error instanceof Error ? error.message : "Could not export diagnostics.";
      this.#changed();
    });
  };

  controlSurfaceError(page: HuiPage): string {
    if (page.id === "connection") return [this.piError, this.healthError].filter(Boolean).join(" ");
    if (page.id === "memory-import") return this.workspaceError;
    return this.piError;
  }

  props(): Omit<SettingsProps, keyof AutomationProps | "page" | "worktrees" | "onRefreshObservability" | "onSelectPage" | "onChangeModels" | "onStartChat" | "onClose"
    | "gateways" | "onAddGateway" | "onEditGateway" | "onSwitchGateway" | "onRemoveGateway" | "onRetryGateway"> {
    return {
      pi: this.pi,
      piLoading: this.piLoading,
      piError: this.piError,
      health: this.health,
      healthError: this.healthError,
      power: this.power,
      workspaces: this.workspaceInspection,
      workspaceError: this.workspaceError,
      observability: this.observability,
      observabilityError: this.observabilityError,
      canOpenExtensionPanel: false,
      onExportDiagnostics: this.exportDiagnostics,
      onRetryPi: () => this.loadControlSurfaceData(true),
      onSaveSubagentRoute: this.saveSubagentRoute,
      previews: this.previews,
      settings: this.settings,
      themeId: this.themeId,
      variant: this.variant,
      saveFailed: this.saveFailed,
      importNote: this.themeImportNote,
      importFailed: this.themeImportFailed,
      onSelectTheme: this.chooseTheme,
      onSelectMode: this.chooseMode,
      onSelectAccent: this.chooseAccent,
      onChangeBranchPrefix: (branchPrefix) => void this.save({ branchPrefix }),
      appearance: this.appearance,
      appearanceSaveFailed: this.appearanceSaveFailed,
      onChangeAppearance: this.saveAppearance,
      onChangeChat: (chat) => this.saveAppearance({ chat }),
      onChangeBrowser: (browser) => this.save({ browser }),
      onChangeVscode: (vscode) => this.save({ vscode }),
      onChangeCodemode: (codemode) => void this.save({ codemode }),
      onChangeNotifications: (notifications) => void this.save({ notifications }),
      onSaveNtfy: this.saveNtfy,
      onTestNtfy: this.testNtfyNotification,
      onCopyNtfyAddress: this.copyNtfyAddress,
      pushDevice: this.pushDevice,
      pushSubscribed: this.pushSubscribed,
      pushDevices: this.pushDevices,
      pushStatusError: this.pushStatusError,
      onEnablePush: () => void this.enablePushOnThisDevice(),
      onDisablePush: () => void this.disablePushOnThisDevice(),
      onTestPush: () => void this.testPushNotification(),
      onChangeQuestions: (questions) => void this.save({ questions }),
      onChangeCalls: (calls) => void this.save({ calls }),
      onChangePower: (power) => void this.save({ power }).then(() => this.refreshPower()),
      onSetLidAwake: this.setLidAwake,
      onImportTheme: this.importTheme,
      piOperation: this.piOperation,
      piRemoveCandidate: this.piRemoveCandidate,
      onInstallPackage: this.installPiPackage,
      onRequestRemovePackage: this.requestPiPackageRemoval,
      onCancelRemovePackage: this.cancelPiPackageRemoval,
      onConfirmRemovePackage: this.removePiPackage,
      onInstallSkill: this.installPiSkill,
      onSetSkillEnabled: this.setPiSkillEnabled,
      onSetPluginEnabled: this.setPiPluginEnabled,
      onReadSkill: (skill) => this.readPiResource("skill", skill),
      onReadPlugin: (resource) => this.readPiResource("plugin", resource),
    };
  }
}
