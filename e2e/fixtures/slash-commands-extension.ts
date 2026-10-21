import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Load only in a disposable PI configuration for command and extension-tool journeys. A `fixture_echo` call the
 * fixture provider makes with E2E_HOLD runs until the provider's POST /control/release-replay, and one with the text
 * "fail" fails. */
export default function slashCommandsFixture(pi: ExtensionAPI) {
  pi.registerTool({
    name: "fixture_echo", label: "Fixture echo", description: "Echo text from the isolated PI extension.",
    parameters: Type.Object({ text: Type.String() }),
    async execute(id, { text }, _signal, _onUpdate, ctx) {
      if (id.startsWith("tool-e2e-hold-")) await fetch(new URL("/control/wait-command", ctx.model!.baseUrl));
      if (text === "fail") throw new Error("Fixture echo failed on purpose.");
      return { content: text ? [{ type: "text", text: `Extension tool executed: ${text}` }] : [], details: {} };
    },
  });
  pi.registerCommand("check-status", {
    description: "Report extension status without a model turn",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Extension executed: ${args}`, "info");
    },
  });
}
