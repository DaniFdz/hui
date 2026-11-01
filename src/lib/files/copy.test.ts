import { describe, expect, test } from "vitest";
import { filesDeleteRisks, filesDeleteTitle, filesTabTitle } from "./copy.ts";

describe("the delete confirmation's list of what goes", () => {
  test("names a file with its size, and a folder with everything inside it", () => {
    expect(filesDeleteRisks({ path: "gone.txt", directory: false, symlink: false, size: "4 B" })).toEqual(["The file gone.txt (4 B)."]);
    expect(filesDeleteRisks({ path: "docs", directory: true, symlink: false })).toEqual(["The folder docs and everything inside it."]);
  });

  test("keeps what a deleted link points to", () => {
    expect(filesDeleteRisks({ path: "outside", directory: false, symlink: true })).toEqual(["The link outside. What it points to is kept."]);
    expect(filesDeleteRisks({ path: "linked", directory: true, symlink: true })).toEqual(["The link linked. What it points to is kept."]);
  });

  test("adds the unsaved edits and the open file that closes", () => {
    expect(filesDeleteRisks({ path: "docs", directory: true, symlink: false, unsaved: "inner.txt", open: "docs/inner.txt" })).toEqual([
      "The folder docs and everything inside it.",
      "Unsaved edits to inner.txt.",
      "The open file docs/inner.txt closes.",
    ]);
    expect(filesDeleteRisks({ path: "gone.txt", directory: false, symlink: false, open: "gone.txt" })).toEqual(["The file gone.txt."]);
  });
});

test("the tab caption is the selected file's name, or Files", () => {
  expect(filesTabTitle(undefined)).toBe("Files");
  expect(filesTabTitle("sub/keep.txt")).toBe("keep.txt");
  expect(filesDeleteTitle("docs")).toBe("Delete docs?");
});