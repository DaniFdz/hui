/** macOS sleep prevention, reported by `GET /__hui/power` when the gateway runs
 * on macOS. The gateway owns the helper processes; views render this. */
export type PowerState = {
  state: "off" | "pending" | "active" | "error";
  /** Why it is pending or failed, or that the Mac already had it on outside HUI. */
  detail: string;
};

export type PowerStatus = {
  keepAwake: PowerState;
  lidAwake: PowerState;
  /** The lid switch for this gateway run; every gateway start begins off. */
  lidOn: boolean;
};
