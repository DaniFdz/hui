/** Pins the SideStore source JSON the release and nightly workflows attach beside the IPA: the shape SideStore reads,
 * the fields its decoder needs, and the changelog text it shows. The fixture in `fixtures/sidestore/` is the whole
 * expected file for one release, so a change to the format shows up as a diff rather than passing quietly. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { BUNDLE_ID, MIN_OS_VERSION, fitNotes, sidestoreSource } from "./sidestore-source.mjs";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const changelog = readFileSync(path("./fixtures/sidestore/changelog.md"), "utf8");
const expected = JSON.parse(readFileSync(path("./fixtures/sidestore/source.json"), "utf8"));

/** One release, as the workflow names it: the tag, the IPA's own version and build, and its asset. */
const release = {
  repository: "DaniFdz/hui",
  tag: "v1.2.3",
  version: "1.2.3",
  buildVersion: "29250123",
  ipaName: "hui-1.2.3.ipa",
  size: 5_242_880,
  date: "2026-11-09T12:03:00Z",
  notes: changelog,
};

test("a release's source JSON is the fixture SideStore reads", () => {
  assert.deepEqual(sidestoreSource(release), expected);
});

test("the version entry installs the IPA the release publishes", () => {
  const source = sidestoreSource(release);
  const [app] = source.apps;
  assert.equal(source.name, "HUI");
  assert.equal(app.bundleIdentifier, BUNDLE_ID);
  const [version] = app.versions;
  // SideStore signs and installs the IPA at this URL, and only offers it to a device that meets minOSVersion.
  assert.equal(version.downloadURL, "https://github.com/DaniFdz/hui/releases/download/v1.2.3/hui-1.2.3.ipa");
  assert.equal(version.size, 5_242_880);
  assert.equal(version.minOSVersion, MIN_OS_VERSION);
  // The version must repeat the IPA's Info.plist exactly, and SideStore's date decoder takes no fractional seconds.
  assert.equal(version.version, "1.2.3");
  assert.equal(version.buildVersion, "29250123");
  assert.equal(version.date, "2026-11-09T12:03:00Z");
  // The icon is the release's own copy, so a source can never point at a branch that moved.
  assert.equal(app.iconURL, "https://github.com/DaniFdz/hui/raw/v1.2.3/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
  // AltStore's format keeps the newest version on the app too; both shapes name the same release.
  assert.equal(app.version, version.version);
  assert.equal(app.downloadURL, version.downloadURL);
  assert.equal(app.versionDate, version.date);
  assert.equal(app.versionDescription, version.localizedDescription);
  assert.equal(app.beta, undefined);
});

test("the nightly channel marks the same app a prerelease", () => {
  const source = sidestoreSource({ ...release, tag: "nightly", version: "1.2.4-nightly.20261109120300.g1a2b3c4", beta: true });
  assert.equal(source.apps[0].beta, true);
  assert.equal(source.apps[0].versions[0].downloadURL, "https://github.com/DaniFdz/hui/releases/download/nightly/hui-1.2.3.ipa");
});

test("the notes SideStore shows are the changelog, without markdown", () => {
  const notes = sidestoreSource(release).apps[0].versions[0].localizedDescription;
  // The release URL leads, headings and link syntax are gone, and each commit keeps its subject and short hash.
  assert.match(notes, /^Release notes: https:\/\/github\.com\/DaniFdz\/hui\/releases\/tag\/v1\.2\.3\n/u);
  assert.ok(!notes.includes("#"), "a markdown heading would show as a literal hash in SideStore");
  assert.ok(!notes.includes("]("), "a markdown link would show as literal brackets in SideStore");
  assert.ok(notes.includes("- feat: add the Android and iOS apps around the web UI (1a2b3c4)"));
  // The changelog's closing diff link loses its meaning without the URL, so it is dropped rather than half-shown.
  assert.ok(!notes.includes("Full diff since"));
  // Over the budget it keeps the first lines and says how many are left, like release.mjs's own truncation.
  const fitted = fitNotes(["# v1", ...Array.from({ length: 20 }, (_, index) => `- commit number ${index} of a long release`)].join("\n"), { budget: 120 });
  assert.ok(fitted.length < 260, fitted);
  assert.match(fitted, /- …and \d+ more commits, each in the release notes\.$/u);
});

test("a source is refused when SideStore could not install from it", () => {
  assert.throws(() => sidestoreSource({ ...release, repository: "hui" }), /owner\/repository/u);
  assert.throws(() => sidestoreSource({ ...release, tag: "v 1.2.3" }), /release tag/u);
  assert.throws(() => sidestoreSource({ ...release, version: "latest" }), /semantic version/u);
  assert.throws(() => sidestoreSource({ ...release, buildVersion: "abc" }), /buildVersion/u);
  assert.throws(() => sidestoreSource({ ...release, size: 0 }), /size in bytes/u);
  assert.throws(() => sidestoreSource({ ...release, date: "yesterday" }), /ISO 8601/u);
  assert.throws(() => sidestoreSource({ ...release, ipaName: "" }), /file name/u);
});

test("the command refuses an option it does not know", () => {
  const directory = mkdtempSync(join(tmpdir(), "hui-sidestore-typo-"));
  assert.throws(
    () => execFileSync(process.execPath, [path("./sidestore-source.mjs"), "--repository", "DaniFdz/hui", "--tga", "v1.2.3", "--out", join(directory, "out.json")], { encoding: "utf8", stdio: "pipe" }),
    /Unknown option --tga/u,
  );
});

test("the command writes the source for the IPA it is given", () => {
  const directory = mkdtempSync(join(tmpdir(), "hui-sidestore-"));
  const ipa = join(directory, "hui-1.2.3.ipa");
  writeFileSync(ipa, Buffer.alloc(4096));
  const out = join(directory, "hui-sidestore.json");
  const notes = join(directory, "notes.md");
  writeFileSync(notes, changelog);
  execFileSync(process.execPath, [
    path("./sidestore-source.mjs"),
    "--repository", "DaniFdz/hui",
    "--tag", "nightly",
    "--version", "1.2.4-nightly.20261109120300.g1a2b3c4",
    "--build", "29250123",
    "--ipa", ipa,
    "--notes", notes,
    "--out", out,
    "--date", "2026-11-09T12:03:00+01:00",
    "--beta",
  ], { encoding: "utf8" });
  const written = JSON.parse(readFileSync(out, "utf8"));
  const [version] = written.apps[0].versions;
  // The size is the file's own, so the source can never promise an asset that does not match it.
  assert.equal(version.size, 4096);
  assert.equal(version.downloadURL, "https://github.com/DaniFdz/hui/releases/download/nightly/hui-1.2.3.ipa");
  // An offset date is normalised to UTC without fractional seconds.
  assert.equal(version.date, "2026-11-09T11:03:00Z");
  assert.equal(written.apps[0].beta, true);
});
