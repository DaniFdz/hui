import assert from "node:assert/strict";
import { test } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("attachment image route is guarded, typed and never resolves unknown sessions or indexes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-attachment-route-"));
  process.env["XDG_CONFIG_HOME"] = dir;
  await mkdir(join(dir, "hui"));
  const now = new Date().toISOString();
  await writeFile(join(dir, "hui", "sessions.json"), JSON.stringify({ version: 1, sessions: [
    { id: "alpha", title: "Alpha", tool: "pi", cwd: dir, createdAt: now, updatedAt: now },
  ], groups: [] }));
  const { middleware } = await import("../hui.ts");
  const { stopBackend } = await import("../backend.ts");
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404).end(); }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  t.onTestFinished(async () => { await stopBackend(); server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); await rm(dir, { recursive: true, force: true }); });
  const get = (path: string, guard = true, method = "GET") => fetch(origin + path, { method, headers: guard ? { "x-hui": "1" } : {} });

  assert.equal((await get("/__hui/sessions/alpha/attachments/0/0", false)).status, 403);
  assert.equal((await fetch(origin + "/__hui/sessions/alpha/attachments/0/0", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await fetch(origin + "/__hui/sessions/missing/attachments/0/0", { headers: { "sec-fetch-site": "same-origin" } })).status, 404);
  assert.equal((await get("/__hui/sessions/missing/attachments/0/0")).status, 404);
  const outOfRange = await get("/__hui/sessions/alpha/attachments/99/7");
  assert.equal(outOfRange.status, 404);
  assert.doesNotMatch(await outOfRange.text(), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((await get("/__hui/sessions/alpha/attachments/0/0", true, "DELETE")).status, 405);
  assert.equal((await get("/__hui/sessions/alpha/attachments/0/files/0", false)).status, 403);
  assert.equal((await get("/__hui/sessions/alpha/attachments/0/files/0")).status, 404);
});

test("a stored file attachment opens inline as a PDF and downloads under its name otherwise", async () => {
  const { storeAttachmentFile } = await import("../sessions/attachments.ts");
  const { createAttachmentRoutes } = await import("./attachments.ts");
  const files = [
    await storeAttachmentFile("alpha", "report.pdf", Buffer.from("%PDF-1.4").toString("base64")),
    await storeAttachmentFile("alpha", "página notes.html", Buffer.from("<script>").toString("base64")),
    await storeAttachmentFile("alpha", "Dani's notes (1).txt", Buffer.from("notes").toString("base64")),
    await storeAttachmentFile("alpha", "\uD800.bin", Buffer.from("x").toString("base64")),
  ];
  const routes = createAttachmentRoutes({
    session: async () => ({}),
    liveSessions: { attachmentFile: (_id, _message, file) => files[file], attachmentImage: async () => undefined },
  });
  const get = (file: number) => routes.handle({ method: "GET", path: `/__hui/sessions/alpha/attachments/0/files/${file}`, query: new URLSearchParams(), headers: { "x-hui": "1" }, json: async () => ({}), bytes: async () => Buffer.alloc(0), signal: new AbortController().signal });

  const pdf = await get(0);
  assert.ok(pdf && "file" in pdf);
  assert.equal(pdf.file.mimeType, "application/pdf");
  assert.equal(pdf.file.headers["content-disposition"], "inline; filename*=UTF-8''report.pdf");
  assert.equal(pdf.file.data.toString(), "%PDF-1.4");
  const html = await get(1);
  assert.ok(html && "file" in html);
  assert.equal(html.file.mimeType, "application/octet-stream");
  assert.equal(html.file.headers["content-disposition"], "attachment; filename*=UTF-8''p%C3%A1gina%20notes.html");
  assert.match(html.file.headers["content-security-policy"] ?? "", /sandbox/u);
  const apostrophe = await get(2);
  assert.ok(apostrophe && "file" in apostrophe);
  assert.equal(apostrophe.file.headers["content-disposition"], "attachment; filename*=UTF-8''Dani%27s%20notes%20%281%29.txt");
  const surrogate = await get(3);
  assert.ok(surrogate && "file" in surrogate);
  assert.equal(surrogate.file.headers["content-disposition"], "attachment; filename*=UTF-8''%EF%BF%BD.bin");
  assert.equal((await get(4))?.status, 404);
});

test("stored attachment files are only read from inside the attachment store", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-attachment-store-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const store = join(dir, "store");
  const { readStoredAttachment, storeAttachmentFile } = await import("../sessions/attachments.ts");
  const stored = await storeAttachmentFile("alpha", "notes.md", Buffer.from("notes").toString("base64"), store);
  assert.equal((await readStoredAttachment(stored.path, store))?.toString(), "notes");

  const outside = join(dir, "secret.txt");
  await writeFile(outside, "secret");
  await symlink(outside, join(store, "alpha", "link.txt"));
  assert.equal(await readStoredAttachment(outside, store), undefined);
  assert.equal(await readStoredAttachment(join(store, "alpha", "..", "..", "secret.txt"), store), undefined);
  assert.equal(await readStoredAttachment(join(store, "alpha", "link.txt"), store), undefined);
  assert.equal(await readStoredAttachment(join(store, "alpha"), store), undefined);
  assert.equal(await readStoredAttachment(join(store, "alpha", "missing"), store), undefined);
});

test("public transcript replaces runtime attachment locations with opaque URLs", async () => {
  const { publicTranscript } = await import("../sessions/live-sessions.ts");
  assert.deepEqual(publicTranscript("a b", [{ kind: "message", role: "user", text: "", attachments: [
    { name: "s.png", kind: "image", mimeType: "image/png", source: { message: 3, image: 1 } },
    { name: "n.txt", kind: "file", source: { message: 3, file: 0 } },
    { name: "legacy.txt", kind: "file" },
  ] }]), [{ kind: "message", role: "user", text: "", attachments: [
    { name: "s.png", kind: "image", mimeType: "image/png", url: "/__hui/sessions/a%20b/attachments/3/1" },
    { name: "n.txt", kind: "file", url: "/__hui/sessions/a%20b/attachments/3/files/0" },
    { name: "legacy.txt", kind: "file" },
  ] }]);
});
