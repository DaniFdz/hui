import assert from "node:assert/strict";
import { test } from "vitest";
import { File } from "node:buffer";
import { readFileSync } from "node:fs";
import { attachmentBytes, attachmentCountMessage, attachmentRefusal, attachmentTooLargeMessage, attachmentTotalMessage, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_COUNT, MAX_FILES_PANE_BYTES, MAX_PROMPT_ATTACHMENT_BYTES, readAttachment, validateAttachmentTotal } from "./attachments.ts";
import type { Attachment } from "../api/sessions.ts";

const fixture: { maxCount: number; maxItemBytes: number; maxTotalBytes: number; filesPaneMaxBytes: number } =
  JSON.parse(readFileSync(new URL("./attachments.fixture.json", import.meta.url), "utf8"));

const attachment = (dataBase64: string): Attachment => ({ kind: "file", name: "a", mimeType: "text/plain", dataBase64 });

test("computes decoded attachment bytes including padding", () => {
  assert.equal(attachmentBytes(attachment("YQ==")), 1);
  assert.equal(attachmentBytes(attachment("YWI=")), 2);
});

test("every limit equals its field in the shared gateway fixture", () => {
  assert.deepEqual({ maxCount: MAX_ATTACHMENT_COUNT, maxItemBytes: MAX_ATTACHMENT_BYTES, maxTotalBytes: MAX_PROMPT_ATTACHMENT_BYTES, filesPaneMaxBytes: MAX_FILES_PANE_BYTES }, fixture);
});

test("a size refusal keeps its first sentence and points at the Files pane", () => {
  assert.equal(attachmentTooLargeMessage("clip.mov"), "clip.mov is larger than 12 MB. Larger files can go in the Files pane, which takes up to 2 GB each.");
  assert.equal(attachmentTotalMessage(), "Attachments must be 16 MB or less in total. Larger files can go in the Files pane, which takes up to 2 GB each.");
  // Too many files is not a size problem: the Files pane does not take them, another message does.
  assert.equal(attachmentCountMessage(), "At most 8 attachments may be sent at once. Send the rest in another message.");
});

test("rejects an aggregate larger than the safe request budget", () => {
  const eightMegabytes = attachment("A".repeat(Math.ceil((8 * 1024 * 1024 * 4) / 3 / 4) * 4));
  assert.throws(
    () => validateAttachmentTotal([eightMegabytes, eightMegabytes, attachment("YQ==")]),
    { message: "Attachments must be 16 MB or less in total. Larger files can go in the Files pane, which takes up to 2 GB each." },
  );
});

test("matches the gateway count and per-item limits", () => {
  const tiny = attachment("YQ==");
  assert.doesNotThrow(() => validateAttachmentTotal(Array(8).fill(tiny)));
  assert.throws(
    () => validateAttachmentTotal(Array(9).fill(tiny)),
    { message: "At most 8 attachments may be sent at once. Send the rest in another message." },
  );

  const overTwelveMegabytes = attachment("A".repeat(Math.ceil(((12 * 1024 * 1024 + 1) * 4) / 3 / 4) * 4));
  assert.throws(
    () => validateAttachmentTotal([overTwelveMegabytes]),
    { message: "a is larger than 12 MB. Larger files can go in the Files pane, which takes up to 2 GB each." },
  );
});

test("an oversize pick is refused before its bytes are read into memory", async () => {
  // No `arrayBuffer`: reaching it would fail with a TypeError instead of this message.
  const oversize = { name: "clip.mov", size: MAX_ATTACHMENT_BYTES + 1, type: "video/quicktime" } as unknown as globalThis.File;
  await assert.rejects(readAttachment(oversize), {
    message: "clip.mov is larger than 12 MB. Larger files can go in the Files pane, which takes up to 2 GB each.",
  });
});

test("the send-time refusal is the same wording, and nothing else", () => {
  const tiny = attachment("YQ==");
  assert.equal(attachmentRefusal([]), undefined);
  assert.equal(attachmentRefusal(Array(8).fill(tiny)), undefined);
  assert.equal(attachmentRefusal(Array(9).fill(tiny)), attachmentCountMessage());
  assert.equal(attachmentRefusal([{ ...tiny, name: "clip.mov", dataBase64: "A".repeat(Math.ceil(((12 * 1024 * 1024 + 1) * 4) / 3 / 4) * 4) }]), "clip.mov is larger than 12 MB. Larger files can go in the Files pane, which takes up to 2 GB each.");
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
