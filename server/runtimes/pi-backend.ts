/**
 * Which transport the PI worker uses — the SDK by default, or the CLI when the operator opts in — and the PI SDK
 * version HUI pins and reports.
 */
export const PI_SDK_VERSION = "1.0.1";

/** An explicit fallback, never an automatic retry after a partially run turn. */
export function piBackend(): "sdk" | "cli" {
  const value = process.env["HUI_PI_BACKEND"] ?? "sdk";
  if (value !== "sdk" && value !== "cli") throw new Error("HUI_PI_BACKEND must be sdk or cli.");
  return value;
}
