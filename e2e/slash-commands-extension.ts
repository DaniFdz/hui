import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Load only in a disposable PI configuration for the slash-command journey. */
export default function slashCommandsFixture(pi: ExtensionAPI) {
  pi.registerCommand("check-status", {
    description: "Report extension status without a model turn",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Extension executed: ${args}`, "info");
    },
  });
}
