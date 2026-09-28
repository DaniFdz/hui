export const PI_SDK_VERSION = "0.87.1";

/** An explicit fallback, never an automatic retry after a partially run turn. */
export function piBackend(): "sdk" | "cli" {
  const value = process.env["HUI_PI_BACKEND"] ?? "sdk";
  if (value !== "sdk" && value !== "cli") throw new Error("HUI_PI_BACKEND must be sdk or cli.");
  return value;
}
