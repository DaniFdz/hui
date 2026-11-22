/** Checks the browser's file-path helpers against the portable wire fixtures, and the uploaded-file request the Files
 * view sends: it reports progress, can be cancelled, refuses a file the gateway would refuse, and fails when its body
 * stops making progress or the answer to a fully sent one never arrives. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, vi } from "vitest";
import { BODY_STALL_MS } from "./request.ts";
import { fileExtension, FilesRequestError, isMarkdownPath, isUploadCancelled, MAX_RESOLVE_PATHS, MAX_UPLOAD_FILE_BYTES, uploadFile } from "./files.ts";

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

  /** The upload object's own `load`: the browser reporting the whole body sent. */
  uploaded() {
    this.upload.dispatchEvent(new Event("load"));
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

test("cancelling an upload aborts its request instead of waiting for it", async (t) => {
  serve();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  const cancellation = new AbortController();
  const pending = uploadFile("s", "", new File(["half"], "half.bin"), false, { signal: cancellation.signal });
  const request = await FakeRequest.sent();
  cancellation.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.equal(isUploadCancelled(error), true, "a cancel stays a cancellation, never a stall");
    assert.equal(error instanceof FilesRequestError, false);
    return true;
  });
  assert.equal(request.aborted, true);
  assert.equal(vi.getTimerCount(), 0, "a cancelled upload leaves no pending deadline");

  serve();
  const gone = new AbortController();
  gone.abort();
  await assert.rejects(uploadFile("s", "", new File(["x"], "x.bin"), false, { signal: gone.signal }), (error: unknown) => isUploadCancelled(error));
  assert.equal(FakeRequest.opened, 0, "a cancelled upload opens no request");
});

test("an upload whose body stops making progress fails instead of hanging", async (t) => {
  serve();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  const pending = uploadFile("s", "videos", new File([new Uint8Array(12)], "clip.mov"), false);
  const request = await FakeRequest.sent();
  // The handler goes on before the deadline fires, so the rejection is never reported as unhandled.
  let outcome: unknown;
  const reading = pending.then((entry) => entry, (error: unknown) => { outcome = error; });
  request.progress(3, 12);
  await vi.advanceTimersByTimeAsync(BODY_STALL_MS - 1);
  assert.equal(request.aborted, false, "a body still inside the deadline is left alone");
  await vi.advanceTimersByTimeAsync(1);
  // Assert the outcome before awaiting it: a deadline that never fired would otherwise hang this test instead of
  // failing it, because vitest's own timeout is faked along with the upload's.
  assert(outcome instanceof FilesRequestError, "the stall deadline must settle the upload");
  assert.equal(outcome.status, 0, "no HTTP answer arrived, so there is no status to report");
  assert.match(outcome.message, /“clip\.mov” stopped uploading at 25% \(3 B of 12 B sent\)/u);
  assert.match(outcome.message, /Nothing was saved and the folder is unchanged/u);
  assert.equal(isUploadCancelled(outcome), false, "a stall is not a cancellation");
  assert.equal(request.aborted, true, "the stalled upload releases its connection");
  assert.equal(vi.getTimerCount(), 0, "a stalled upload leaves no pending deadline");
  await reading;
});

test("an upload whose body is fully sent but whose answer never arrives says it may have finished", async (t) => {
  serve();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  // The browser reports a finished body either with a last progress that accounts for every byte or with the upload's
  // own `load`; both have to leave the deadline honest about what it is still waiting for.
  const completions: Array<[string, (request: FakeRequest) => void]> = [
    ["its last progress", (request) => request.progress(12, 12)],
    ["the upload load event", (request) => request.uploaded()],
  ];
  for (const [how, complete] of completions) {
    const pending = uploadFile("s", "videos", new File([new Uint8Array(12)], "clip.mov"), false);
    const request = await FakeRequest.sent();
    // The handler goes on before the deadline fires, so the rejection is never reported as unhandled.
    let outcome: unknown;
    const reading = pending.then((entry) => entry, (error: unknown) => { outcome = error; });
    request.progress(11, 12);
    complete(request);
    // Every byte is out and the 201 never comes back, which is a gateway that may already have renamed the file into
    // place: the deadline still settles the upload, but it can no longer promise the folder was left alone.
    await vi.advanceTimersByTimeAsync(BODY_STALL_MS);
    assert(outcome instanceof FilesRequestError, `a body reported finished by ${how} is still settled by the deadline`);
    assert.equal(outcome.status, 0, "no HTTP answer arrived, so there is no status to report");
    assert.equal(
      outcome.message,
      "“clip.mov” sent all of 12 B, but HUI did not answer. The upload may have finished; check the folder.",
      `the message after ${how} names what was sent and where to look`,
    );
    assert.doesNotMatch(outcome.message, /Nothing was saved/u, "a completed body may already have been committed");
    assert.equal(isUploadCancelled(outcome), false, "an unanswered upload is not a cancellation");
    assert.equal(request.aborted, true, "the unanswered upload releases its connection");
    assert.equal(vi.getTimerCount(), 0, "an unanswered upload leaves no pending deadline");
    await reading;
  }
});

test("an upload that keeps sending bytes outlives the stall deadline", async (t) => {
  serve();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  t.onTestFinished(() => { vi.useRealTimers(); });
  const pending = uploadFile("s", "", new File([new Uint8Array(4)], "big.mov"), false);
  const request = await FakeRequest.sent();
  // Three rounds of just under the deadline add up to well past it, and no round goes quiet for long enough.
  for (let sent = 1; sent <= 3; sent++) {
    await vi.advanceTimersByTimeAsync(BODY_STALL_MS - 1);
    request.progress(sent, 4);
    assert.equal(request.aborted, false, "a body that keeps arriving is never aborted");
  }
  request.answer(201, JSON.stringify({ entry: { name: "big.mov", path: "big.mov", kind: "file", size: 4 } }));
  // Checked before the answer is awaited, so a leaked or still-armed deadline fails here instead of hanging.
  assert.equal(request.aborted, false, "the upload has no total deadline");
  assert.equal(vi.getTimerCount(), 0, "a finished upload leaves no pending deadline");
  assert.equal((await pending).path, "big.mov");
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
