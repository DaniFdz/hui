/** The SideStore source JSON a release publishes beside its unsigned IPA (mobile/AGENTS.md, WP8). SideStore is
 * an AltStore fork, so the file is AltStore's source format: one app, one version entry pointing at this release's IPA
 * asset, the release's changelog as what SideStore shows for it. The release and nightly workflows write it with this
 * script and attach it to the same release as the IPA; `docs/guide.md` gives the two URLs SideStore subscribes to. */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The bundle id of the release app and the IPA's own, from `capacitor.config.ts` and `mobile/ios`. */
export const BUNDLE_ID = "dev.hui.app";
/** `IPHONEOS_DEPLOYMENT_TARGET` of `mobile/ios/App/App.xcodeproj`, which is what the IPA's Info.plist carries. */
export const MIN_OS_VERSION = "15.0";
/** HUI's accent colour (`themes/hui.json`), which SideStore tints the app's page with. */
export const TINT_COLOR = "#0b6bcb";
/** The app icon SideStore shows: the 1024 px iOS icon in the release's own tag. */
const ICON_PATH = "mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png";
/** SideStore shows `localizedDescription` as plain text on a phone's screen, so the changelog is fitted to this. */
export const NOTES_BUDGET = 4000;

const trim = (text) => text.replace(/\s+$/u, "");

/** The release's changelog as SideStore can show it: no headings, no markdown links (their label stays), and only the
 * first lines that fit the budget, with the count of the ones left out. `release.mjs` closes its changelog with a
 * "Full diff since …" link, which loses its meaning without the URL and is dropped here; the release URL leads instead.
 * @param {string} text the changelog markdown
 * @param {{ budget?: number }} [options] characters to spend on it
 * @returns {string} the fitted notes
 */
export function fitNotes(text, { budget = NOTES_BUDGET } = {}) {
  const lines = text
    .split("\n")
    // The links go first: the changelog's closing line only says what it is once its label is all that is left.
    .map((line) => trim(line.trim().replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")))
    .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("Full diff since"));
  const kept = [];
  let used = 0;
  for (const line of lines) {
    if (kept.length > 0 && used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  const omitted = lines.length - kept.length;
  return [...kept, ...(omitted > 0 ? [`- …and ${omitted} more commits, each in the release notes.`] : [])].join("\n");
}

/**
 * Build the source JSON for one release.
 * @param {object} release
 * @param {string} release.repository `owner/repository` the release lives in
 * @param {string} release.tag the release's tag (`v1.2.3`, or `nightly`)
 * @param {string} release.version `CFBundleShortVersionString` of the IPA, which the source must repeat exactly
 * @param {string} release.buildVersion `CFBundleVersion` of the IPA, the commit time in minutes
 * @param {string} release.ipaName the IPA asset's file name
 * @param {number} release.size the IPA's size in bytes
 * @param {string} release.date the release's date, ISO 8601
 * @param {string} release.notes the release's changelog, markdown
 * @param {string} [release.minOSVersion] the IPA's minimum iOS version
 * @param {boolean} [release.beta] mark it a prerelease, for the nightly channel
 * @returns {object} the source JSON, ready to be written
 */
export function sidestoreSource({
  repository,
  tag,
  version,
  buildVersion,
  ipaName,
  size,
  date,
  notes,
  minOSVersion = MIN_OS_VERSION,
  beta = false,
}) {
  const parts = (repository ?? "").split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9._-]+$/u.test(part))) {
    throw new Error("A SideStore source needs the owner/repository it is published from.");
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(tag ?? "")) throw new Error("A SideStore source needs the release tag it publishes.");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version ?? "")) {
    throw new Error("A SideStore version entry needs a semantic version (the IPA's CFBundleShortVersionString).");
  }
  if (!/^\d+$/u.test(String(buildVersion ?? ""))) throw new Error("A SideStore version entry needs the IPA's numeric buildVersion.");
  if (!Number.isInteger(size) || size <= 0) throw new Error("A SideStore version entry needs the IPA's size in bytes.");
  if (Number.isNaN(new Date(date).getTime())) throw new Error("A SideStore version entry needs an ISO 8601 date.");
  if (!ipaName) throw new Error("A SideStore version entry needs the IPA asset's file name.");

  const [owner] = parts;
  const iconURL = `https://github.com/${repository}/raw/${tag}/${ICON_PATH}`;
  const downloadURL = `https://github.com/${repository}/releases/download/${tag}/${ipaName}`;
  const releaseURL = `https://github.com/${repository}/releases/tag/${tag}`;
  // SideStore's date decoding takes ISO 8601 without fractional seconds.
  const isoDate = new Date(date).toISOString().replace(/\.\d{3}Z$/u, "Z");
  const description = `HUI on the phone: the shell around your own gateway's web UI, which asks for the address of the gateway you run (https:// through \`tailscale serve\`). It bundles no copy of the UI and keeps no account of its own. This IPA is unsigned: SideStore signs it with your Apple ID, which lasts seven days and is renewed by SideStore (see HUI's user guide).`;
  const entry = {
    version,
    buildVersion: String(buildVersion),
    date: isoDate,
    localizedDescription: fitNotes(`Release notes: ${releaseURL}\n\n${notes}`),
    downloadURL,
    size,
    minOSVersion,
  };
  return {
    name: "HUI",
    identifier: BUNDLE_ID,
    subtitle: "Your HUI gateway, on the phone",
    description,
    iconURL,
    website: `https://github.com/${repository}`,
    tintColor: TINT_COLOR,
    apps: [
      {
        name: "HUI",
        bundleIdentifier: BUNDLE_ID,
        developerName: owner,
        subtitle: "Your HUI gateway, on the phone",
        localizedDescription: description,
        iconURL,
        tintColor: TINT_COLOR,
        // AltStore's source format keeps the newest version's fields on the app as well as in `versions`, and every
        // published source carries both; a decoder that reads either shape then finds the same release.
        version,
        buildVersion: String(buildVersion),
        versionDate: isoDate,
        versionDescription: entry.localizedDescription,
        ...(beta ? { beta: true } : {}),
        size,
        downloadURL,
        versions: [entry],
      },
    ],
  };
}

/** `--name value` pairs and `--flag` switches from the command line. An unknown name is refused: a typo in a workflow
 * would otherwise write a source that quietly says the wrong thing. */
function parseArgs(argv) {
  const switches = ["beta", "help"];
  const values = ["repository", "tag", "version", "build", "ipa", "notes", "out", "date"];
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const name = argument.slice(2);
    if (!switches.includes(name) && !values.includes(name)) {
      throw new Error(`Unknown option --${name}; it is one of ${[...values, ...switches].map((known) => `--${known}`).join(", ")}.`);
    }
    if (switches.includes(name)) args[name] = true;
    else {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`--${name} needs a value.`);
      args[name] = value;
      index += 1;
    }
  }
  return args;
}

const USAGE = `Usage: node scripts/sidestore-source.mjs --repository <owner/repo> --tag <tag> --version <x.y.z>
       --build <n> --ipa <path> --notes <path> --out <path> [--date <iso>] [--beta]

Writes the SideStore source JSON for the IPA the release publishes. --build is the IPA's CFBundleVersion (the commit
time in minutes, as the workflows pass it), --date defaults to the commit's own time, and --beta marks the nightly
channel as a prerelease.`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  for (const required of ["repository", "tag", "version", "build", "ipa", "notes", "out"]) {
    if (!args[required]) throw new Error(`--${required} is required.\n\n${USAGE}`);
  }
  const date = args.date ?? execFileSync("git", ["log", "-1", "--format=%cI"], { encoding: "utf8" }).trim();
  const source = sidestoreSource({
    repository: args.repository,
    tag: args.tag,
    version: args.version,
    buildVersion: args.build,
    ipaName: args.ipa.split("/").pop(),
    size: statSync(args.ipa).size,
    date,
    notes: readFileSync(args.notes, "utf8"),
    beta: args.beta === true,
  });
  writeFileSync(args.out, `${JSON.stringify(source, null, 2)}\n`);
  console.log(`Wrote ${args.out} for ${source.apps[0].bundleIdentifier} ${args.version} (${args.build}).`);
}
