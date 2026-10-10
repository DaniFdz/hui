import assert from "node:assert/strict";
import test from "node:test";
import { base64, downloadName, importSource, parseBotImportPreview, pickedFile, pickedFolder } from "./bot-templates.ts";

test("a picked file or folder becomes a source, refused here when the gateway would refuse it", async () => {
  const bytes = new TextEncoder().encode("You are Nova.");
  const file = { name: "nova.md", size: bytes.length, arrayBuffer: async () => bytes.buffer };
  const picked = await pickedFile(file);
  assert.deepEqual(picked, { label: "nova.md", size: bytes.length, source: { kind: "file", name: "nova.md", data: Buffer.from(bytes).toString("base64") } });
  await assert.rejects(pickedFile({ ...file, size: 9 * 1024 * 1024 }), /larger than 8 MB/u);
  const folder = await pickedFolder([{ ...file, name: "SOUL.md", webkitRelativePath: "nova/SOUL.md" }, { ...file, name: "IDENTITY.md", webkitRelativePath: "nova/IDENTITY.md" }]);
  assert.equal(folder.label, "nova/ (2 files)");
  assert.deepEqual(folder.source.kind === "files" ? folder.source.files.map((entry) => entry.path) : [], ["nova/SOUL.md", "nova/IDENTITY.md"]);
  await assert.rejects(pickedFolder([]), /empty/u);
  assert.equal(base64(new Uint8Array(70_000).fill(65)).length, Math.ceil(70_000 / 3) * 4, "large files go in chunks");
});

test("each tab's source, or what is missing", () => {
  assert.equal(importSource("file", { url: "", text: "" }), "Choose a file or a folder first.");
  assert.deepEqual(importSource("link", { url: " https://x.ai/bot/marketplace/bots/a ", text: "" }), { kind: "url", url: "https://x.ai/bot/marketplace/bots/a" });
  assert.equal(importSource("link", { url: " ", text: "" }), "Paste a Grok Bot marketplace link first.");
  assert.deepEqual(importSource("paste", { url: "", text: "Be terse." }), { kind: "text", text: "Be terse." });
});

test("a download's name comes from its Content-Disposition; a malformed preview is an error, never half a preview", () => {
  assert.equal(downloadName("attachment; filename=\"nova.hui-bot.zip\"; filename*=UTF-8''nova%C3%B1.hui-bot.zip", "x.zip"), "novañ.hui-bot.zip");
  assert.equal(downloadName("attachment; filename=\"nova.hui-bot.zip\"", "x.zip"), "nova.hui-bot.zip");
  assert.equal(downloadName(null, "x.zip"), "x.zip");
  assert.throws(() => parseBotImportPreview({ template: { format: "grok" } }), /did not come back/u);
  assert.throws(() => parseBotImportPreview({ template: { format: "future" }, bot: {}, soul: "", skills: [], routines: [], integrations: [], disabledTools: [], disabledSkills: [], dropped: [], notes: [], memories: {} }), /format this HUI does not know/u);
  const preview = { template: { format: "grok" }, bot: { name: "A", handle: "a" }, soul: "", skills: [], routines: [], integrations: [], disabledTools: [], disabledSkills: [], dropped: [], notes: [], memories: { included: 0, total: 0 } };
  assert.equal(parseBotImportPreview(preview), preview);
});
