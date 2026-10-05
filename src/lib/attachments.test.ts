import assert from "node:assert/strict";
import test from "node:test";
import { File } from "node:buffer";
import { attachmentBytes, readAttachment, readTranscriptImages, validateAttachmentTotal } from "./attachments.ts";
import type { Attachment } from "./sessions-store.ts";

const attachment = (dataBase64: string): Attachment => ({ kind: "file", name: "a", mimeType: "text/plain", dataBase64 });

test("computes decoded attachment bytes including padding", () => {
  assert.equal(attachmentBytes(attachment("YQ==")), 1);
  assert.equal(attachmentBytes(attachment("YWI=")), 2);
});

test("rejects an aggregate larger than the safe request budget", () => {
  const eightMegabytes = attachment("A".repeat(Math.ceil((8 * 1024 * 1024 * 4) / 3 / 4) * 4));
  assert.throws(() => validateAttachmentTotal([eightMegabytes, eightMegabytes, attachment("YQ==")]), /16 MB/);
});

test("matches the gateway count and per-item limits", () => {
  const tiny = attachment("YQ==");
  assert.doesNotThrow(() => validateAttachmentTotal(Array(8).fill(tiny)));
  assert.throws(() => validateAttachmentTotal(Array(9).fill(tiny)), /At most 8/);

  const overTwelveMegabytes = attachment("A".repeat(Math.ceil(((12 * 1024 * 1024 + 1) * 4) / 3 / 4) * 4));
  assert.throws(() => validateAttachmentTotal([overTwelveMegabytes]), /larger than 12 MB/);
});

test("rejects names the gateway cannot safely store", async () => {
  const common = new File(["hi"], "captura final 🏂.png", { type: "image/png" });
  assert.equal((await readAttachment(common as unknown as globalThis.File)).name, "captura final 🏂.png");
  assert.throws(
    () => validateAttachmentTotal([{ ...attachment("YQ=="), name: "../note.txt" }]),
    /path separators or controls/,
  );
  assert.throws(
    () => validateAttachmentTotal([{ ...attachment("YQ=="), name: "bad\u0000name.txt" }]),
    /path separators or controls/,
  );
  assert.throws(
    () => validateAttachmentTotal([{ ...attachment("YQ=="), name: ".." }]),
    /path separators or controls/,
  );
});

test("reads a sent message's images back into composer attachments, skipping files and unreadable images", async (t) => {
  const served = new Map([["/ok", new Response(new Blob(["png"], { type: "image/png" }))]]);
  t.mock.method(globalThis, "fetch", async (url: string) => served.get(url) ?? new Response("", { status: 404 }));
  const restored = await readTranscriptImages([
    "legacy.txt",
    { name: "notes.md", kind: "file" },
    { name: "shot.png", kind: "image", mimeType: "image/png", url: "/ok" },
    { name: "gone.png", kind: "image", mimeType: "image/png", url: "/gone" },
  ]);
  assert.deepEqual(restored, [{ kind: "image", name: "shot.png", mimeType: "image/png", dataBase64: "cG5n" }]);
});
