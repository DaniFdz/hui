/**
 * The fixture's own test selection: the shared suite's config with its test glob aimed at the capability checks in this
 * directory, so a new step or world can be proven without becoming an area's use case first. They keep the suite's
 * target and launcher lines by spreading `e2e.config.ts`; only the root moves, because `--config` makes this directory
 * the project root, so every command runs with the repository as its working directory and the launcher's own relative
 * paths stay where `hui.ts` reads them.
 *
 *   npx e2e run --config e2e/fixtures/capabilities.config.ts --target web e2e/fixtures
 *
 * A capability check proves what the fixture can drive. An area's use case stays in `e2e/tests/`, tagged with its
 * catalogue ID, and reads the same steps.
 */
import type { E2EConfig } from "e2e";
import base from "../../e2e.config.ts";

const repo = "../..";

export default {
  ...base,
  tests: "**/*.e2e.ts",
  targets: base.targets.map((target) => ({
    ...target,
    app: {
      ...target.app,
      command: { ...target.app.command!, cwd: repo, log: `.e2e/logs/hui-${target.name}.log` },
    },
  })),
} satisfies E2EConfig;
