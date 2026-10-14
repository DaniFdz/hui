/** The demo clips, in overview order. Prompts match the scripted model in provider.ts. */
import type { Director, Target } from "./record.ts";

export type SceneContext = { director: Director; api: (method: string, path: string, body?: unknown) => Promise<Record<string, any>> };
export type Scene = {
  name: string;
  /** The chapter tag under the window. */
  chapter: string;
  /** HUI path the clip opens on, and text that shows it is ready. */
  path?: string;
  ready?: Target;
  /** CSS size of HUI's window; smaller shows larger text. */
  viewport?: [number, number];
  /** On a phone: 390×844 in a phone frame, with touch input. */
  device?: "phone";
  /** Opens VS Code, which needs --accept-vscode-license. */
  vscode?: boolean;
  /** localStorage entries HUI loads with, such as view preferences. */
  storage?: Record<string, string>;
  /** What the narrator says, by key: `director.say(key)` speaks a line during the clip (with --voice). */
  narration?: Record<string, string>;
  /** Runs before recording starts. */
  setup?: (context: SceneContext) => Promise<void>;
  run: (context: SceneContext) => Promise<void>;
};

const card = (title: string, column?: string): Target => ({ css: `${column ? `.kanban-cell--${column} ` : ""}.kanban-card__title`, text: title });
const link = (text: string): Target => ({ css: "a", text });
/** A subagent's sidebar row, whose link also shows its run time. */
const child = (title: string): Target => ({ css: "a", contains: title });

/** Sends a follow-up once the session is idle, whose composer reads "Send a message…" (a busy one reads "Add to this run…"). */
async function send(d: Director, prompt: string) {
  await d.click({ placeholder: "Send a message…" });
  await d.type(prompt);
  await d.pause(300);
  await d.press("Enter");
}

export const scenes: Scene[] = [
  {
    name: "kanban",
    chapter: "Kanban",
    path: "/kanban",
    ready: { contains: "Drag a backlog item" },
    // Lanes by custom group, Storefront first, instead of long project paths.
    storage: { "hui.kanban-options": JSON.stringify({ groupBy: "custom" }) },
    narration: {
      board: "This is H U I's Kanban board. Every agent session is a card, in the stage its work is in.",
      drag: "When the work moves on, drag the card along.",
      backlog: "A backlog item starts its own session, in a fresh Git worktree, with a branch name suggested for you.",
      work: "The agent gets going right away: it reads the code, writes the change, and runs the tests.",
      stage: "Agents keep the board up to date themselves. Tell this one that CI passed, and it moves its own card to Testing.",
    },
    async run({ director: d }) {
      await d.caption("Every session is a card, in the stage its work is in");
      await d.say("board");
      await d.move(card("Apple Pay at checkout"));
      await d.pause(1_600);

      await d.caption("Drag a card when the work moves on");
      await d.say("drag");
      await d.zoom({ css: ".kanban-cell--testing", nth: 0 }, 1.35);
      await d.drag({ css: ".kanban-card", contains: "Search results skeleton" }, { css: ".kanban-cell--done", nth: 0 });
      await d.waitFor(card("Search results skeleton", "done"));
      await d.pause(700);
      await d.zoom();

      await d.caption("Start a backlog item in its own worktree");
      await d.say("backlog");
      await d.click(card("Add CSV export to the orders page"));
      await d.waitFor("New worktree");
      await d.zoom({ css: "dialog" }, 1.3);
      await d.click("New worktree");
      await d.cut(() => d.waitFor({ contains: "feature/orders-csv-export" }));
      await d.pause(1_200);
      await d.click({ css: "button", text: "Start session" });
      await d.zoom();
      await d.waitFor(card("Add CSV export to the orders page", "investigation"));
      await d.pause(800);

      await d.caption("The agent gets to work right away");
      await d.say("work");
      await d.click(card("Add CSV export to the orders page", "investigation"));
      await d.zoom({ x: 860, y: 430 }, 1.3);
      await d.waitFor({ contains: "node --test" }, 30_000);
      await d.pause(1_800);
      await d.zoom();

      await d.caption("Agents report their own stage");
      await d.say("stage");
      await d.click(link("Apple Pay at checkout"));
      await send(d, "CI passed on Apple Pay. Move it to review.");
      await d.waitFor({ contains: "moved this card to" }, 30_000);
      await d.pause(800);
      await d.click(link("Kanban"));
      await d.waitFor(card("Apple Pay at checkout", "testing"));
      await d.zoom(card("Apple Pay at checkout", "testing"), 1.4);
      await d.pause(2_000);
      await d.zoom();
      await d.caption();
      await d.still("board");
    },
  },
  {
    name: "integrations",
    chapter: "Rich chat",
    viewport: [1280, 720],
    ready: "Apple Pay at checkout",
    narration: {
      chart: "Answers don't have to be walls of text. Ask for a chart of this week's builds,",
      widget: "and the agent draws an interactive widget, right in the chat, on your theme.",
      browser: "It can drive a real browser too. You watch the page live while it fills in the signup form.",
      cards: "Links unfurl into cards, like the merged pull request and the Slack thread behind it.",
    },
    async run({ director: d }) {
      await d.caption("Ask for a chart");
      await d.say("chart");
      await d.click({ label: "New session in STOREFRONT" });
      await d.click({ placeholder: "What should this session work on?" });
      await d.type("Chart this week's build times from ci/build-times.csv");
      await d.press("Enter");
      await d.caption("…and get an interactive widget, on your theme");
      await d.say("widget");
      await d.waitFor({ contains: "Toggle the series" }, 30_000);
      await d.zoom({ css: ".hui-widget-card__frame" }, 1.3);
      // The widget runs in its own sandboxed frame; its toggle sits at the top left.
      const widget = await d.waitFor({ css: ".hui-widget-card__frame" });
      await d.click({ x: widget.x + 130, y: widget.y + 24 });
      await d.pause(1_600);
      await d.click({ x: widget.x + 40, y: widget.y + 24 });
      await d.pause(900);
      await d.zoom();
      await d.still("widget");

      await d.caption("It drives a real browser, live in the chat");
      await d.say("browser");
      await send(d, "Check that signup still works on staging");
      await d.waitFor({ css: ".hui-browser-preview" }, 30_000);
      await d.zoom({ css: ".hui-browser-preview" }, 1.35);
      // The page's own confirmation, which the script quotes only when the browser really got there.
      await d.waitFor({ contains: "We sent a link to dana@acme.dev" }, 40_000);
      await d.pause(600);
      await d.zoom();
      await d.caption("Links unfurl into cards");
      await d.say("cards");
      await d.waitFor({ css: ".github-embed" });
      await d.zoom({ css: ".github-embed" }, 1.35);
      await d.pause(2_200);
      await d.zoom();
      await d.still("browser");
      await d.caption();
    },
  },
  {
    name: "workpane",
    chapter: "Terminal, diff and VS Code",
    path: "/sessions/demo-10",
    ready: { contains: "Format them as currency" },
    vscode: true,
    narration: {
      terminal: "Every conversation has a Work pane beside it. Open a terminal, already in the project's folder.",
      agent: "The agent can use the same terminal. You watch it run the tests, live.",
      diff: "The Diff view shows exactly what changed, file by file.",
      files: "Click a file to open it in the Files view,",
      vscode: "or open the whole project in V S Code, without leaving the browser.",
    },
    async run({ director: d }) {
      await d.caption("Every conversation has a Work pane");
      await d.say("terminal");
      await d.click({ label: "Open terminal" });
      await d.waitFor({ contains: "Shared · Connected" });
      const terminal = await d.waitFor({ css: ".hui-terminal-surface" });
      // The prompt and output sit at the top of the terminal.
      const output = { x: terminal.x + terminal.width / 2, y: terminal.y + 150 };
      await d.zoom(output, 1.5);
      await d.click({ x: terminal.x + 120, y: terminal.y + 40 });
      await d.type("git status --short && git log --oneline -1", { terminal: true });
      await d.press("Enter");
      await d.pause(1_400);
      await d.zoom();

      await d.caption("The agent can type in your terminal too");
      await d.say("agent");
      await send(d, "Go ahead, and run the tests in my terminal");
      await d.zoom(output, 1.5);
      await d.waitFor({ contains: "3 tests pass in your terminal" }, 40_000);
      await d.pause(1_200);
      await d.zoom();

      await d.caption("Every change, in the Diff view");
      await d.say("diff");
      await d.click({ label: "Maximize Work pane" });
      await d.click({ label: "Open Work view" });
      await d.click({ css: ".work-pane__menu-item[value='launch:diff']" });
      await d.click({ css: ".hui-diff-file[data-path='src/orders/orders-page.js']" });
      await d.click({ css: ".hui-diff-segmented__option", text: "Side by side" });
      await d.waitFor({ contains: "formatTotal(order.total" });
      await d.still("diff");
      await d.zoom({ css: ".hui-diff-main" }, 1.4);
      await d.pause(2_200);
      await d.zoom();

      await d.caption("Open a file in Files");
      await d.say("files");
      await d.click({ css: ".hui-diff-main__open" });
      await d.waitFor({ css: ".hui-files-editor" });
      await d.pause(1_800);

      await d.caption("…or the whole project in VS Code");
      await d.say("vscode");
      await d.click({ label: "Open Work view" });
      await d.click({ css: ".work-pane__menu-item[value='launch:vscode']" });
      // VS Code's server starts (and downloads its build the first time); the clip skips the wait.
      await d.cut(() => d.waitFor({ css: "[aria-label^='Source Control']" }, 300_000));
      await d.pause(800);
      await d.click({ css: "[aria-label^='Source Control']" });
      await d.click({ css: ".monaco-list-row", contains: "orders-page.js" });
      await d.pause(1_000);
      await d.zoom({ css: ".monaco-workbench" }, 1.3);
      await d.pause(2_400);
      await d.zoom();
      await d.still("vscode");
      await d.caption();
    },
  },
  {
    name: "subagents",
    chapter: "Subagents and watchers",
    viewport: [1280, 720],
    ready: "Apple Pay at checkout",
    narration: {
      ask: "Big jobs can be split up. Here, one code review becomes three, running in parallel.",
      children: "Each subagent works in its own session, right there in the sidebar.",
      report: "As they finish, they report back, and the parent sums up what they found.",
      open: "You can open any of them to see exactly what it did.",
      watcher: "For things that take a while, like CI, the agent leaves a watcher behind. It waits in the background, and merges once the checks go green.",
    },
    async run({ director: d }) {
      await d.caption("Ask for a review that splits three ways");
      await d.say("ask");
      await d.click({ label: "New session in PAYMENTS" });
      await d.click({ placeholder: "What should this session work on?" });
      await d.type("Review PR #142 before we merge: security, performance and test coverage, in parallel");
      await d.press("Enter");
      await d.caption("Each subagent runs in its own session");
      await d.say("children");
      await d.waitFor(child("Test coverage review"), 30_000);
      await d.zoom(child("Performance review"), 1.6);
      await d.pause(2_400);
      await d.zoom();
      await d.caption("…and reports back when it's done");
      await d.say("report");
      await d.waitFor({ contains: "All three reviews are in" }, 40_000);
      await d.pause(2_200);
      await d.caption("Open any subagent to see its work");
      await d.say("open");
      await d.click(child("Security review"));
      await d.waitFor({ contains: "1 blocking issue" });
      await d.zoom({ contains: "1 blocking issue" }, 1.4);
      await d.pause(2_200);
      await d.zoom();
      await d.click({ label: "Open parent" });
      await d.caption("Watchers wait on CI for you");
      await d.say("watcher");
      await send(d, "Fix the ownership check, then merge once CI is green");
      await d.waitFor({ css: ".chat-watcher" }, 30_000);
      await d.zoom({ css: ".chat-watcher" }, 1.4);
      await d.pause(1_500);
      // HUI checks on watchers every 10 s; skip to the moment CI is green.
      await d.cut(() => d.waitFor({ contains: "CI green, merged #142" }, 30_000));
      await d.pause(1_200);
      await d.click({ css: ".chat-watcher" });
      await d.waitFor({ css: ".chat-watcher__log" });
      await d.pause(2_200);
      await d.zoom();
      await d.still("watcher");
      await d.caption();
    },
  },
  {
    name: "bots",
    chapter: "Bots",
    viewport: [1280, 720],
    ready: "Apple Pay at checkout",
    async setup({ api }) {
      const soul = (who: string) => `# Who I am\n${who} Short answers, always with the next step.\n`;
      const { bot } = await api("POST", "/__hui/bots", { name: "Scout", title: "Release captain", avatar: { shape: "blob", color: "#5b8cff" }, soul: soul("Scout, the team's release captain.") });
      await api("POST", "/__hui/bots", { name: "Pixel", title: "Design reviewer", avatar: { shape: "heart", color: "#ff7a6b", ears: "cat" }, soul: soul("Pixel, who reviews UI changes.") });
      await api("POST", "/__hui/bots", { name: "Owl", title: "On-call buddy", avatar: { emoji: "🦉" }, soul: soul("Owl, who watches the pager overnight.") });
      await api("POST", `/__hui/bots/${bot.id}/messages`, { text: "Heads-up: refunds roll out to 10% of stores on Monday, and Priya owns the rollback.", wait: true });
    },
    narration: {
      roster: "Bots are agents that stay. Each one has a face, a single long-running chat, and a memory.",
      routine: "They schedule their own routines. Ask Scout for a weekday digest, and it sets one up.",
      run: "Run it now, and the digest already knows what you told it earlier.",
      memory: "And everything it remembers is right here, for you to read.",
    },
    async run({ director: d }) {
      await d.caption("Bots are agents that stay: a face, one chat and a memory");
      await d.say("roster");
      await d.click({ css: "#sidebar-tab-bots" });
      await d.waitFor("Owl");
      await d.zoom({ css: ".bot-roster" }, 1.8);
      await d.pause(1_800);
      await d.zoom();
      await d.click({ css: ".bot-row__name", text: "Scout" });
      await d.caption("They schedule their own routines");
      await d.say("routine");
      await send(d, "Every weekday at 9, post a digest of open PRs and today's rollouts");
      await d.waitFor({ contains: "runs every weekday at 9:00" }, 30_000);
      await d.pause(1_000);
      await d.caption("Run one now, and it remembers what you told it");
      await d.say("run");
      await d.click({ label: "Run now: Morning digest" });
      await d.waitFor({ contains: "Nothing is blocked" }, 30_000);
      await d.zoom({ contains: "Priya owns the rollback" , last: true }, 1.4);
      await d.pause(2_200);
      await d.zoom();
      await d.caption("Its memory is yours to read");
      await d.say("memory");
      await d.click({ css: ".bot-panel__tab[data-tab=memory]" });
      await d.pause(800);
      await d.still("memory");
      await d.zoom({ css: ".bot-panel__tab[data-tab=memory]" }, 1.5);
      await d.pause(2_400);
      await d.zoom();
      await d.caption();
    },
  },
  {
    name: "phone",
    chapter: "On your phone",
    device: "phone",
    path: "/sessions/demo-1",
    ready: { contains: "Add Apple Pay to checkout" },
    storage: { "hui.kanban-options": JSON.stringify({ groupBy: "custom" }) },
    narration: {
      phone: "And it all works on your phone. Reach your laptop over Tailscale, and your sessions are right there.",
      ask: "Check in on an agent from anywhere,",
      board: "or keep an eye on the whole board, wherever you are.",
    },
    async run({ director: d }) {
      await d.caption("HUI works on your phone too");
      await d.say("phone");
      await d.pause(2_000);
      await d.caption("Check in from anywhere");
      await d.say("ask");
      await d.click({ placeholder: "Send a message…" });
      await d.type("Quick status on Apple Pay?");
      // On a touch screen Return adds a line; the send button sends.
      await d.click({ label: "Send message" });
      await d.waitFor({ contains: "Want me to open the pull request?" }, 30_000);
      await d.zoom({ contains: "Want me to open the pull request?" }, 1.35);
      await d.pause(1_600);
      await d.zoom();
      await d.still("chat");
      await d.caption("The board fits in your pocket");
      await d.say("board");
      await d.click({ label: "Open navigation" });
      await d.pause(900);
      await d.click(link("Kanban"));
      await d.waitFor({ contains: "Drag a backlog item" });
      await d.pause(800);
      // Each lane scrolls sideways through the stages.
      await d.swipe({ css: ".kanban-cell--backlog", nth: 0 }, 260);
      await d.pause(900);
      await d.swipe({ css: ".kanban-cell--investigation", nth: 0 }, 300);
      await d.waitFor(card("Apple Pay at checkout"));
      await d.pause(1_800);
      await d.caption();
    },
  },
];
