import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * The tool names this extension answers that a test can hold: a call the fixture provider makes with `E2E_HOLD` waits on
 * the provider's `POST /control/release-replay` before it answers, so a test can read HUI's row, its state and the
 * working indicator while the call is in flight. `read_file`, `apply_patch` and `git_status` carry the names HUI's
 * indicator maps to "Reading files…", "Editing files…" and "Checking git…" (`lib/chat-projection.ts`), and `read_file`
 * renders as a read card (`lib/tool-cards.ts`); PI's own `read`, `edit` and `bash` cannot be paused mid-execution, so a
 * held call to one of those keeps running past the assertion.
 */
/** Load only in a disposable PI configuration for command and extension-tool journeys. A call the fixture provider makes
 * with E2E_HOLD runs until the provider's POST /control/release-replay, and one with the text "fail" fails. */
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
  const holdable = (name: string, label: string, description: string) => pi.registerTool({
    name, label, description,
    parameters: Type.Object({ path: Type.Optional(Type.String()), command: Type.Optional(Type.String()) }),
    async execute(id, input, _signal, _onUpdate, ctx) {
      if (id.startsWith("tool-e2e-hold-")) await fetch(new URL("/control/wait-command", ctx.model!.baseUrl));
      const argument = input.path ?? input.command ?? name;
      return { content: [{ type: "text", text: `${label} finished for ${argument}` }], details: {} };
    },
  });
  holdable("read_file", "Fixture read", "Read a file through the isolated PI extension.");
  holdable("apply_patch", "Fixture patch", "Apply a patch through the isolated PI extension.");
  holdable("git_status", "Fixture git", "Report a Git status through the isolated PI extension.");
  pi.registerCommand("check-status", {
    description: "Report extension status without a model turn",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Extension executed: ${args}`, "info");
    },
  });
}
