/** The interface and chat prose fonts restyle their own parts of the app, the terminal font takes a typed local family, and Text size scales the text together; all of them persist (SET-009, SET-010, SET-011). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const FACES = /^\s*Instrument Sans.*Geist.*DM Sans.*IBM Plex Sans.*Space Grotesk.*Atkinson Hyperlegible.*Fraunces.*Lora.*JetBrains Mono.*System/su;

test("the interface font restyles navigation, settings and controls, the chat prose font the conversation, code stays monospace, and both persist", { tags: ["SET-009"], platforms: ["web"] }, async ({ screen, hui }) => {
  const face = async (target: Locator) => (await hui.look(target)).font.split(",")[0]!.replaceAll('"', "").trim();
  const caption = screen.getByText("HUI · A little clarity goes a long way");
  const prose = screen.getByText("Good typography makes room for the conversation. Choose a face that feels comfortable to read.");
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Typeset" });
  await hui.prompt(session, "E2E_MARKDOWN_PARITY");

  await hui.open("/settings/appearance");
  for (const [picker, chosen] of [["Chat prose font", "Lora"], ["Interface font", "Geist"]] as const) {
    await screen.getByRole("button", `${picker}: Instrument Sans`).tap();
    const faces = screen.getByLabel(picker);
    await expect(faces).toHaveText(FACES);
    await faces.getByText(chosen, { exact: true }).tap();
    await expect(screen.getByRole("button", `${picker}: ${chosen}`)).toBeVisible();
  }
  await expect.poll(() => face(caption)).toBe("Geist");
  expect(await face(prose)).toBe("Lora");
  expect(await face(screen.getByText("Message width", { exact: true }))).toBe("Geist");
  expect(await face(screen.getByLabel("Settings pages").getByText("Gateway"))).toBe("Geist");
  await expect.poll(async () => (await hui.api<{ fontUi: string; fontChat: string }>("GET", "/__hui/settings")).fontChat).toBe("lora");

  await hui.open(`/sessions/${session.id}`);
  await expect(transcript.getByText("Final paragraph.")).toBeVisible();
  expect(await face(transcript.getByText("Final paragraph."))).toBe("Lora");
  expect(await face(transcript.getByText("inline code"))).toBe("JetBrains Mono");
  expect(await face(transcript.getByText("fixture code", { exact: false }))).toMatch(/Mono|monospace/u);
  expect(await face(screen.getByLabel("Message"))).toBe("Geist");
  expect(await face(screen.getByTestId("session-row").filter({ hasText: "Typeset" }))).toBe("Geist");

  await hui.reload();
  await expect(transcript.getByText("Final paragraph.")).toBeVisible();
  expect(await face(transcript.getByText("Final paragraph."))).toBe("Lora");
  expect(await face(screen.getByLabel("Message"))).toBe("Geist");
  await hui.open("/settings/appearance");
  await expect(screen.getByRole("button", "Interface font: Geist")).toBeVisible();
  await expect(screen.getByRole("button", "Chat prose font: Lora")).toBeVisible();
  expect(await face(caption)).toBe("Geist");
  expect(await face(prose)).toBe("Lora");
});

test("the terminal font lists monospace and Nerd Fonts, takes a typed local family over the bundled symbols, persists, and falls back to JetBrains Mono", { tags: ["SET-010"], platforms: ["web"] }, async ({ screen, hui }) => {
  const stack = async () => (await hui.look(screen.getByLabel("Terminal font preview"))).font;
  const fonts = screen.getByLabel("Terminal font");

  await hui.open("/settings/appearance");
  expect(await stack()).toMatch(/^"JetBrains Mono", "HUI Nerd Font Symbols"/u);
  await screen.getByRole("button", "Terminal font: JetBrains Mono").tap();
  await expect(fonts).toHaveText(/JetBrains Mono.*MesloLGS NF.*MesloLGS Nerd Font Mono.*JetBrainsMono Nerd Font Mono.*FiraCode Nerd Font Mono.*Hack Nerd Font Mono.*CaskaydiaCove Nerd Font Mono.*Menlo.*Consolas/su);
  const search = screen.getByLabel("Search or type a font name");
  await search.fill('Bad"Font');
  await expect(screen.getByText("No matches", { visible: true })).toBeVisible();
  await expect(fonts.getByText("Use this local font")).toBeHidden();
  await search.fill("DejaVu Sans Mono");
  await fonts.getByText("Use this local font").tap();
  await expect(screen.getByRole("button", "Terminal font: DejaVu Sans Mono")).toBeVisible();
  await expect.poll(stack).toMatch(/^"DejaVu Sans Mono", "HUI Nerd Font Symbols", "JetBrains Mono"/u);

  await hui.reload();
  await expect(screen.getByRole("button", "Terminal font: DejaVu Sans Mono")).toBeVisible();
  expect(await stack()).toMatch(/^"DejaVu Sans Mono", "HUI Nerd Font Symbols"/u);

  for (const typed of ["   ", "Mono; color: red"]) {
    await hui.api("PUT", "/__hui/settings", { ...(await hui.api<Record<string, unknown>>("GET", "/__hui/settings")), fontTerminal: typed });
    await hui.reload();
    await expect(screen.getByRole("button", "Terminal font: JetBrains Mono")).toBeVisible();
    expect(await stack()).toMatch(/^"JetBrains Mono", "HUI Nerd Font Symbols"/u);
  }
});

test("Text size scales the text of Settings, the sidebar, the conversation and the composer together, and persists", { tags: ["SET-011"], platforms: ["web"] }, async ({ screen, hui }) => {
  const sizes = screen.getByLabel("Text size");
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Scaled" });
  await hui.prompt(session, "E2E_MARKDOWN_PARITY");
  const settingsText = () => [screen.getByText("Message width", { exact: true }), screen.getByText("Controls the maximum width of the conversation and composer."), screen.getByLabel("Settings pages").getByText("Gateway")];
  const chatText = () => [transcript.getByText("Final paragraph."), transcript.getByText("inline code"), screen.getByLabel("Message")];
  const measure = async (targets: Locator[]) => Promise.all(targets.map(async (target) => Math.round((await hui.look(target)).size * 100) / 100));
  const scaled = (sizes: number[], factor: number) => sizes.map((size) => Math.round(size * factor * 100) / 100);

  await hui.open(`/sessions/${session.id}`);
  await expect(transcript.getByText("Final paragraph.")).toBeVisible();
  const chat = await measure(chatText());
  await hui.open("/settings/appearance");
  for (const name of ["Small 90%", "Large 110%", "XL 125%", "XXL 140%"]) await expect(sizes.getByRole("button", { name, pressed: false })).toBeVisible();
  await expect(sizes.getByRole("button", { name: "Default 100%", pressed: true })).toBeVisible();
  const settings = await measure(settingsText());

  await sizes.getByRole("button", "XL 125%").tap();
  await expect(sizes.getByRole("button", { name: "XL 125%", pressed: true })).toBeVisible();
  await expect.poll(() => measure(settingsText())).toEqual(scaled(settings, 1.25));
  await hui.open(`/sessions/${session.id}`);
  await expect(transcript.getByText("Final paragraph.")).toBeVisible();
  expect(await measure(chatText())).toEqual(scaled(chat, 1.25));

  await hui.reload();
  await expect(transcript.getByText("Final paragraph.")).toBeVisible();
  expect(await measure(chatText())).toEqual(scaled(chat, 1.25));
  await hui.open("/settings/appearance");
  await expect(sizes.getByRole("button", { name: "XL 125%", pressed: true })).toBeVisible();

  await sizes.getByRole("button", "Small 90%").tap();
  await expect.poll(() => measure(settingsText())).toEqual(scaled(settings, 0.9));
});
