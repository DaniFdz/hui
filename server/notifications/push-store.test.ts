/**
 * The gateway's Web Push state on disk: one VAPID keypair generated once and reused, a bounded subscription list that
 * is idempotent per endpoint and replaces a rotated key set, pruning, and private files at mode 0600. A missing or
 * corrupt file is the empty state, and no rejection carries an endpoint or a key.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  MAX_PUSH_SUBSCRIPTIONS,
  addPushSubscription,
  listPushSubscriptions,
  prunePushSubscriptions,
  pushSubscriptionId,
  removePushSubscription,
  vapidKeys,
} from "./push-store.ts";

const directory = (): Promise<string> => mkdtemp(join(tmpdir(), "hui-push-"));
const vapidPath = (dir: string): string => join(dir, "notifications", "vapid.json");
const subscriptionsPath = (dir: string): string => join(dir, "notifications", "push-subscriptions.json");
const mode = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

/** The RFC's application-server point and a 16-byte auth secret: what a page hands over. */
const KEYS = { p256dh: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8", auth: "BTBZMqHH6r4Tts7J_aSIgg" };

/** One browser's subscription for one device. */
function browser(device: string, keys = KEYS): { endpoint: string; keys: { p256dh: string; auth: string }; device: string } {
  return { endpoint: `https://push.example.net/${device}`, keys, device };
}

test("one VAPID keypair is generated once, at mode 0600, and read back from its file", async () => {
  const dir = await directory();
  const keys = await vapidKeys(dir);
  assert.equal(Buffer.from(keys.publicKey, "base64url").length, 65, "the browser needs the uncompressed point");
  assert.equal(Buffer.from(keys.publicKey, "base64url")[0], 4);
  assert.equal(Buffer.from(keys.privateKey, "base64url").length, 32);
  assert.equal(await mode(vapidPath(dir)), 0o600, "the private key is readable only by its owner");
  assert.deepEqual(await readdir(join(dir, "notifications")), ["vapid.json"], "one file, no temporary left behind");

  const stored = JSON.parse(await readFile(vapidPath(dir), "utf8")) as { publicKey: string; privateKey: string };
  assert.deepEqual(stored, keys);
  assert.deepEqual(await vapidKeys(dir), keys, "the same pair every time");

  const written = await directory();
  await mkdir(join(written, "notifications"), { recursive: true });
  await writeFile(vapidPath(written), JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }), "utf8");
  assert.deepEqual(await vapidKeys(written), keys, "a pair already on disk is reused, not replaced");

  const corrupt = await directory();
  await mkdir(join(corrupt, "notifications"), { recursive: true });
  await writeFile(vapidPath(corrupt), "{ not json", "utf8");
  const regenerated = await vapidKeys(corrupt);
  assert.equal(Buffer.from(regenerated.publicKey, "base64url").length, 65, "a corrupt file is regenerated, not thrown");
  assert.equal(Buffer.from(regenerated.privateKey, "base64url").length, 32);
});

test("two callers that arrive together share the one keypair", async () => {
  const dir = await directory();
  const [first, second] = await Promise.all([vapidKeys(dir), vapidKeys(dir)]);
  assert.deepEqual(first, second);
  const stored = JSON.parse(await readFile(vapidPath(dir), "utf8")) as { publicKey: string; privateKey: string };
  assert.deepEqual(stored, first, "the second caller did not generate a pair of its own");
});

test("adding is idempotent per endpoint, and a rotated key set replaces the old one", async () => {
  const dir = await directory();
  const first = await addPushSubscription(browser("phone"), dir);
  assert.equal(first.id, pushSubscriptionId(first.endpoint));
  assert.match(first.id, /^[0-9a-f]{16}$/u);
  assert.equal(first.device, "phone");
  assert.equal(await mode(subscriptionsPath(dir)), 0o600, "a subscription's keys are as private as the VAPID key");

  const again = await addPushSubscription(browser("phone"), dir);
  assert.equal(again.id, first.id, "the same device keeps its id");
  assert.equal(again.createdAt, first.createdAt, "and the day it was registered");
  const listed = await listPushSubscriptions(dir);
  assert.equal(listed.length, 1, "the same endpoint is not a second subscription");
  assert.deepEqual(listed[0], again);

  const rotated = { p256dh: KEYS.p256dh, auth: "another-auth-16b" };
  const replaced = await addPushSubscription({ endpoint: first.endpoint, keys: rotated }, dir);
  assert.equal(replaced.id, first.id);
  assert.equal(replaced.device, "phone", "a browser that says nothing keeps the name the operator gave it");
  const after = await listPushSubscriptions(dir);
  assert.equal(after.length, 1);
  assert.equal(after[0]?.keys.p256dh, rotated.p256dh);
  assert.equal(after[0]?.keys.auth, rotated.auth, "the rotated auth secret is the one stored");
});

test("an https endpoint or a loopback http one is registered, and every other endpoint is refused", async () => {
  const dir = await directory();
  const local = await addPushSubscription({ endpoint: "http://127.0.0.1:8787/push/device", keys: KEYS, device: "local-test" }, dir);
  assert.equal(local.endpoint, "http://127.0.0.1:8787/push/device", "a push service on this machine cannot have TLS");
  const v6 = await addPushSubscription({ endpoint: "http://[::1]:8787/push/device", keys: KEYS }, dir);
  assert.equal(v6.endpoint, "http://[::1]:8787/push/device");
  assert.deepEqual((await listPushSubscriptions(dir)).map((entry) => entry.endpoint), [local.endpoint, v6.endpoint], "both read back from disk");

  const refused = [
    "http://push.example.net/phone", "http://localhost:8787/push/device", "http://127.0.0.2:8787/push/device",
    "not a url", "https://user:pass@push.example.net/x", "wss://push.example.net/x",
  ];
  for (const endpoint of refused) {
    await assert.rejects(addPushSubscription({ ...browser("phone"), endpoint }, dir), (error: Error) => {
      assert.match(error.message, /must be an https: URL/u);
      assert.doesNotMatch(error.message, /push\.example\.net|BCVxsr7N|BTBZMqHH/u);
      return true;
    });
  }
  assert.deepEqual((await listPushSubscriptions(dir)).map((entry) => entry.endpoint), [local.endpoint, v6.endpoint], "a refused endpoint is not a subscription");
});

test("pruning removes exactly the endpoints a push service said are gone", async () => {
  const dir = await directory();
  for (const device of ["phone", "tablet", "laptop"]) await addPushSubscription(browser(device), dir);
  const gone = (await listPushSubscriptions(dir)).filter((entry) => entry.device !== "tablet").map((entry) => entry.endpoint);

  await prunePushSubscriptions(gone, dir);
  const left = await listPushSubscriptions(dir);
  assert.deepEqual(left.map((entry) => entry.device), ["tablet"]);
  await prunePushSubscriptions([], dir);
  assert.deepEqual(await listPushSubscriptions(dir), left, "nothing gone, nothing written");

  await removePushSubscription(left[0]?.endpoint ?? "", dir);
  assert.deepEqual(await listPushSubscriptions(dir), []);
  await removePushSubscription("https://push.example.net/never-registered", dir);
  assert.deepEqual(await listPushSubscriptions(dir), [], "removing what is not there is not an error");
});

test("a corrupt or missing file is the empty state, never an error", async () => {
  const empty = await directory();
  assert.deepEqual(await listPushSubscriptions(empty), []);
  assert.deepEqual(await readdir(empty), [], "reading creates nothing");

  await mkdir(join(empty, "notifications"), { recursive: true });
  for (const junk of ["{ not json", "[]", '{"subscriptions": "no"}', '{"subscriptions": [{"endpoint": "http://push.example.net/x"}]}']) {
    await writeFile(subscriptionsPath(empty), junk, "utf8");
    assert.deepEqual(await listPushSubscriptions(empty), [], junk);
  }
});

test("the list stays bounded, dropping the oldest device rather than refusing the newest", async () => {
  const dir = await directory();
  for (let index = 0; index < MAX_PUSH_SUBSCRIPTIONS + 1; index += 1) {
    // Each add is dated after the one before it, which is what the bound orders on.
    await addPushSubscription(browser(`device-${index}`), dir);
  }
  const listed = await listPushSubscriptions(dir);
  assert.equal(listed.length, MAX_PUSH_SUBSCRIPTIONS);
  assert.equal(listed.some((entry) => entry.device === "device-0"), false, "the oldest subscription made room");
  assert.equal(listed.at(-1)?.device, `device-${MAX_PUSH_SUBSCRIPTIONS}`, "the newest is kept");
});
