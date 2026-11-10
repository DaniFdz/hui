/** The composer completes a path from what the operator typed: the workspace for `@`, and folders, `../` and an
 * absolute prefix as they are typed (CHAT-050). */
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, type Locator, type Screen } from "e2e";
import { test} from "../../fixtures/hui.ts";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** A chat's mention list is the bots it may tag and then local paths; New Session's prompt lists paths alone. */
const paths = (screen: Screen) => screen.getByRole("listbox", { name: /(^|and )local paths$/iu });
/** A suggestion is named by its path and its kind, so a folder is told apart from the file of the same name. */
const entry = (screen: Screen, path: string, kind: "directory" | "file"): Locator =>
  paths(screen).getByRole("option", { name: new RegExp(`^${escapeRegExp(path)} ${kind}$`, "u") });

test("the composer lists the files and folders a typed path matches, opens a chosen folder, inserts a file and retries a failed lookup", { tags: ["CHAT-050"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "notes.txt"), "root\n");
  await writeFile(join(repository.path, "sub", "notes.md"), "notes\n");
  const session = await hui.createSession({ title: "Local paths", cwd: repository.path });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const message = screen.getByLabel("Message");

  // `@` lists the workspace: its folders first, then its files, and never a hidden one.
  await message.fill("Review @");
  await expect(entry(screen, "sub/", "directory")).toBeVisible();
  await expect(entry(screen, "notes.txt", "file")).toBeVisible();
  await expect(entry(screen, ".git/", "directory")).toHaveCount(0);
  // Choosing a folder keeps the list open inside it, and the token becomes that folder.
  await entry(screen, "sub/", "directory").tap();
  await expect(message).toHaveValue("Review @sub/");
  await expect(entry(screen, "sub/keep.txt", "file")).toBeVisible();
  await expect(entry(screen, "sub/notes.md", "file")).toBeVisible();
  // Choosing a file inserts it in place of the token and closes the list.
  await entry(screen, "sub/notes.md", "file").tap();
  await expect(message).toHaveValue("Review @sub/notes.md");
  await expect(paths(screen)).toBeHidden();

  // A path typed as it is, after a space, completes from the session's own workspace.
  await message.fill("Review ./");
  await expect(entry(screen, "./sub/", "directory")).toBeVisible();
  await message.fill("Review ../hui-e2e-repo");
  await expect(entry(screen, `../${basename(repository.path)}/`, "directory")).toBeVisible();
  await message.fill(`Review ${repository.path}/`);
  await expect(entry(screen, `${repository.path}/sub/`, "directory")).toBeVisible();

  // A lookup the gateway refuses says why and offers the retry that answers the next one.
  const refused = await hui.intercept("GET", /\/__hui\/local-paths/u);
  await message.fill("Review @s");
  await refused.arrived();
  await refused.reject(500, "The paths could not be listed.");
  await expect.poll(() => hui.textOf(screen.getByRole("alert"))).toContain("The paths could not be listed.");
  await screen.getByRole("button", "Retry paths").tap();
  await expect(entry(screen, "sub/", "directory")).toBeVisible();

  // New Session's prompt offers the same list for the project directory, with its own loading and empty states.
  await hui.open("/");
  await screen.getByPlaceholder("~/").fill(repository.path);
  await expect(screen.getByLabel("Checkout: feature/current")).toBeVisible();
  const prompt = screen.getByPlaceholder("What should this session work on?");
  const listed = await hui.intercept("GET", /\/__hui\/local-paths/u);
  await prompt.fill("Review @zzzz");
  await listed.arrived();
  await expect(screen.getByText("Loading local paths…")).toBeVisible();
  await listed.answer(JSON.stringify({ paths: [] }));
  await expect(screen.getByText("No matching local paths.")).toBeVisible();
  await prompt.fill("Review @sub/");
  await expect(entry(screen, "sub/keep.txt", "file")).toBeVisible();
});
