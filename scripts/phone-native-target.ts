/** Selects the native app's physical main window and gates obsolete CDP retirement at an operation boundary. */
export type NativeTarget = { url: string; type: string; id: string; description?: string; webSocketDebuggerUrl?: string };

export function attachedNativeTarget(targets: NativeTarget[]): NativeTarget | undefined {
  const attached = targets.filter((target) => {
    if (target.type !== "page" || !/^https?:\/\//u.test(target.url)) return false;
    let description: unknown;
    try { description = JSON.parse(target.description ?? ""); }
    catch { throw new Error(`native window ${target.id} has no valid attachment metadata`); }
    if (!description || typeof description !== "object") throw new Error(`native window ${target.id} has no attachment metadata`);
    const info = description as Record<string, unknown>;
    // Native discovery precedes layout: empty/never-attached views explicitly have no physical frame yet.
    if (typeof info["attached"] === "boolean" && (info["empty"] === true || (info["attached"] === false && info["never_attached"] === true))) return false;
    if (typeof info["attached"] !== "boolean" || typeof info["visible"] !== "boolean"
      || typeof info["width"] !== "number" || !Number.isFinite(info["width"])
      || typeof info["height"] !== "number" || !Number.isFinite(info["height"])) {
      throw new Error(`native window ${target.id} has incomplete attachment metadata: ${target.description}`);
    }
    return info["attached"] && info["visible"] && info["width"] > 0 && info["height"] > 0;
  });
  if (attached.length > 1) throw new Error(`ambiguous attached native main windows: ${attached.map(({ id }) => id).join(", ")}`);
  return attached[0];
}

/** A monitor may invalidate during an action, but only the engine's next connectivity check retires CDP. */
export function nativeTransportGate(connected: () => boolean, retire: () => void) {
  let obsolete = false;
  let retired = false;
  return {
    invalidate() { obsolete = true; },
    isConnected() {
      if (!obsolete) return connected();
      if (!retired) { retired = true; retire(); }
      return false;
    },
  };
}

/** Logical substitution is allowed only for the physical window this transport actually verified. */
export function nativeWindowIdentity(info: Record<string, unknown>, boundId: string, contextId: string): Record<string, unknown> {
  return info["targetId"] === boundId ? { ...info, targetId: `${contextId}:main-window` } : info;
}
