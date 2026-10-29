import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { test } from "vitest";
import { sendJson } from "./route.ts";

test("a disconnected client does not serialize the JSON response it abandoned", () => {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  response.destroy();
  let serialized = 0;
  sendJson(response, 200, { toJSON() { serialized += 1; return { transcript: [] }; } });
  assert.equal(serialized, 0);
});
