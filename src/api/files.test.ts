/** Checks the browser's file-path helpers against the portable wire fixtures, and the uploaded-file request the Files
 * view sends: it reports progress, can be cancelled and refuses a file the gateway would refuse. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, vi } from "vitest";
import { fileExtension, isMarkdownPath, isUploadCancelled, MAX_RESOLVE_PATHS, MAX_UPLOAD_FILE_BYTES, uploadFile } from "./files.ts";

test("file extensions and resolve limits match the portable fixtures", async () => {
  const fixture = JSON.parse(await readFile(new URL("./files.fixture.json", import.meta.url), "utf8"));
  assert.equal(MAX_RESOLVE_PATHS, fixture.maxResolvePaths);
  for (const item of fixture.paths) {
    assert.equal(fileExtension(item.input), item.extension);
    assert.equal(isMarkdownPath(item.input), ["md", "markdown", "mdx"].includes(item.extension));
  }
});

/** The one request the helper opened, standing in for the browser's XMLHttpRequest. */
class FakeRequest extends EventTarget {
  static waiting: Array<(request: FakeRequest) => void> = [];
  static opened = 0;

  static sent(): Promise<FakeRequest> {
    return new Promise((resolve) => FakeRequest.waiting.push(resolve));
  }

  readonly upload = new EventTarget();
  status = 0;
  responseText = "";
  requested: { method: string; url: string } | undefined;
  headers: Record<string, string> = {};
  body: unknown;
  aborted = false;

  open(method: string, url: string) {
    this.requested = { method, url };
    FakeRequest.opened += 1;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: unknown) {
    this.body = body;
    for (const resolve of FakeRequest.waiting.splice(0)) resolve(this);
  }

  abort() {
    this.aborted = true;
    this.dispatchEvent(new Event("abort"));
  }

  progress(loaded: number, total: number) {
    this.upload.dispatchEvent(Object.assign(new Event("progress"), { loaded, total, lengthComputable: true }));
  }

  answer(status: number, text: string) {
    this.status = status;
    this.responseText = text;
    this.dispatchEvent(new Event("load"));
  }
}

function serve() {
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  FakeRequest.opened = 0;
  FakeRequest.waiting = [];
}

test("an upload reports how far it got and answers the entry the gateway wrote", async () => {
  serve();
  const file = new File([new Uint8Array(4)], "clip.mov", { type: "video/quicktime" });
  const progress: Array<[number, number]> = [];
  const pending = uploadFile("s 1", "videos", file, false, { onProgress: (sent, total) => progress.push([sent, total]) });
  const request = await FakeRequest.sent();
  assert.deepEqual(request.requested, { method: "POST", url: "/__hui/sessions/s%201/files/upload?dir=videos&name=clip.mov" });
  assert.equal(request.headers["x-hui"], "1");
  assert.equal(request.headers["content-type"], "application/octet-stream");
  assert.equal(request.body, file);
  request.progress(1, 4);
  request.progress(4, 4);
  request.answer(201, JSON.stringify({ entry: { name: "clip.mov", path: "videos/clip.mov", kind: "file", size: 4 } }));
  assert.equal((await pending).path, "videos/clip.mov");
  assert.deepEqual(progress, [[1, 4], [4, 4]]);
});

test("cancelling an upload aborts its request instead of waiting for it", async () => {
  serve();
  const cancellation = new AbortController();
  const pending = uploadFile("s", "", new File(["half"], "half.bin"), false, { signal: cancellation.signal });
  const request = await FakeRequest.sent();
  cancellation.abort();
  await assert.rejects(pending, (error: unknown) => isUploadCancelled(error));
  assert.equal(request.aborted, true);

  serve();
  const gone = new AbortController();
  gone.abort();
  await assert.rejects(uploadFile("s", "", new File(["x"], "x.bin"), false, { signal: gone.signal }), (error: unknown) => isUploadCancelled(error));
  assert.equal(FakeRequest.opened, 0, "a cancelled upload opens no request");
});

test("a refused upload carries the gateway's reason, and a file past the cap is never sent", async () => {
  serve();
  const existing = uploadFile("s", "src", new File(["x"], "a.ts"), false);
  const request = await FakeRequest.sent();
  request.answer(409, JSON.stringify({ error: "A file with that name already exists.", code: "exists" }));
  await assert.rejects(existing, (error: unknown) => {
    assert(error instanceof Error);
    assert.equal((error as { status?: number }).status, 409);
    assert.equal((error as { code?: string }).code, "exists");
    assert.match(error.message, /already exists/u);
    return true;
  });

  serve();
  const huge = { name: "clip.mov", size: MAX_UPLOAD_FILE_BYTES + 1 } as File;
  await assert.rejects(uploadFile("s", "", huge, false), /larger than 2 GB/u);
  assert.equal(FakeRequest.opened, 0);
});
