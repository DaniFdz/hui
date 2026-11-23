/**
 * Which use cases the `android` target runs: the catalogue entries whose phone status is `required`, as the tags the
 * job passes to `e2e run --tag`.
 *
 * The target needs the selection because the web engine's platform is `web` on both targets, so a test that declares
 * `platforms: ["web"]` runs inside the app's WebView too and the runner cannot tell the two apart. Selecting by tag
 * keeps the selection and the catalogue in one place: `scripts/use-cases.test.ts` proves both directions (every
 * `required` use case has a test the selection runs, and nothing the selection runs covers a use case that is not
 * required), so a phone backlog entry cannot be quietly proven and a required one cannot be quietly skipped.
 *
 * Run it as `node e2e/catalogue/phone.ts` for the comma-separated tag list the CI job hands to `--tag`.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AREAS, type UseCase } from "./types.ts";

/** Every use case in the catalogue, in the order of `AREAS`. */
export async function allUseCases(): Promise<UseCase[]> {
  const areas = await Promise.all(AREAS.map(async (area) => (await import(`./${area.toLowerCase()}.ts`)).default as UseCase[]));
  return areas.flat();
}

/** The use-case IDs the `android` target runs. */
export async function phoneTags(): Promise<string[]> {
  return (await allUseCases()).filter((entry) => entry.phone === "required").map((entry) => entry.id);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write((await phoneTags()).join(","));
}
