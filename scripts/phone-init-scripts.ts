/** Owns attachment-local init-script registration and the successful scripts an Android attempt can replay. */
export type InitScript = { script: unknown; argument: unknown };
type Register = (script: unknown, argument?: unknown) => Promise<void>;

/** A replacement attachment replays the attempt's scripts before the engine configures that same context again. */
export function attachmentInitScripts(register: Register, replay: InitScript[]): Register {
  const registrations: (InitScript & { completion: Promise<void> })[] = [];
  let settled = Promise.resolve();
  return (script, argument) => {
    const existing = registrations.find((entry) => entry.script === script && entry.argument === argument);
    if (existing) return existing.completion;
    const entry = {
      script,
      argument,
      // Share in-flight registrations too, without treating a rejection as a successful installation.
      completion: settled.then(() => register(script, argument)).then(() => {
        if (!replay.some((saved) => saved.script === script && saved.argument === argument)) replay.push({ script, argument });
      }, (error: unknown) => {
        registrations.splice(registrations.indexOf(entry), 1);
        throw error;
      }),
    };
    registrations.push(entry);
    // Preserve native/replay order for distinct concurrent requests; callers still receive their own failures.
    settled = entry.completion.catch(() => undefined);
    return entry.completion;
  };
}
