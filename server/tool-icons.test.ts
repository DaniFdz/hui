import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

const configDir = await mkdtemp(join(tmpdir(), "hui-tool-icons-"));
process.env["HUI_CONFIG_DIR"] = configDir;
const { isToolIconName, readToolIcon, MAX_TOOL_ICON_BYTES } = await import("./tool-icons.ts");
const { USER_TOOL_ICON_DIR } = await import("./paths.ts");

test("an icon name is a flat file with one of the four drawable extensions", () => {
  for (const name of ["github.svg", "k8s.PNG", "logo.webp", "mark.jpeg", "a.jpg", "a-b_c.9.svg"]) {
    assert.equal(isToolIconName(name), true, name);
  }
  for (const name of ["../secret.png", "dir/icon.svg", "icon.gif", ".svg", "icon", "", "a".repeat(90) + ".png", "ic on.svg"]) {
    assert.equal(isToolIconName(name), false, name);
  }
});

test("an icon is read from the config directory with its type and etag", async () => {
  await mkdir(USER_TOOL_ICON_DIR, { recursive: true });
  await writeFile(join(USER_TOOL_ICON_DIR, "git.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  const icon = await readToolIcon("git.svg");
  assert.equal(icon?.type, "image/svg+xml");
  assert.match(icon?.etag ?? "", /^"[0-9a-f]+-[0-9a-f]+"$/u);
  assert.match(icon?.bytes.toString("utf8") ?? "", /<svg/u);
});

test("a missing, unsafe or oversized icon reads as absent", async () => {
  assert.equal(await readToolIcon("missing.png"), undefined);
  assert.equal(await readToolIcon("../git.svg"), undefined);
  await writeFile(join(USER_TOOL_ICON_DIR, "huge.png"), Buffer.alloc(MAX_TOOL_ICON_BYTES + 1));
  assert.equal(await readToolIcon("huge.png"), undefined);
});
