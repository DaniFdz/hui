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
  /** localStorage entries HUI loads with, such as view preferences. */
  storage?: Record<string, string>;
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
    async run({ director: d }) {
      await d.caption("Every session is a card, in the stage its work is in");
      await d.move(card("Apple Pay at checkout"));
      await d.pause(1_600);

      await d.caption("Drag a card when the work moves on");
      await d.zoom({ css: ".kanban-cell--testing", nth: 0 }, 1.35);
      await d.drag({ css: ".kanban-card", contains: "Search results skeleton" }, { css: ".kanban-cell--done", nth: 0 });
      await d.waitFor(card("Search results skeleton", "done"));
      await d.pause(700);
      await d.zoom();

      await d.caption("Start a backlog item in its own worktree");
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
      await d.click(card("Add CSV export to the orders page", "investigation"));
      await d.zoom({ x: 860, y: 430 }, 1.3);
      await d.waitFor({ contains: "node --test" }, 30_000);
      await d.pause(1_800);
      await d.zoom();

      await d.caption("Agents report their own stage");
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
    async run({ director: d }) {
      await d.caption("Ask for a chart");
      await d.click({ label: "New session in STOREFRONT" });
      await d.click({ placeholder: "What should this session work on?" });
      await d.type("Chart this week's build times from ci/build-times.csv");
      await d.press("Enter");
      await d.caption("…and get an interactive widget, on your theme");
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
      await send(d, "Check that signup still works on staging");
      await d.waitFor({ css: ".hui-browser-preview" }, 30_000);
      await d.zoom({ css: ".hui-browser-preview" }, 1.35);
      // The page's own confirmation, which the script quotes only when the browser really got there.
      await d.waitFor({ contains: "We sent a link to dana@acme.dev" }, 40_000);
      await d.pause(600);
      await d.zoom();
      await d.caption("Links unfurl into cards");
      await d.waitFor({ css: ".github-embed" });
      await d.zoom({ css: ".github-embed" }, 1.35);
      await d.pause(2_200);
      await d.zoom();
      await d.still("browser");
      await d.caption();
    },
  },
  {
    name: "subagents",
    chapter: "Subagents and watchers",
    viewport: [1280, 720],
    ready: "Apple Pay at checkout",
    async run({ director: d }) {
      await d.caption("Ask for a review that splits three ways");
      await d.click({ label: "New session in PAYMENTS" });
      await d.click({ placeholder: "What should this session work on?" });
      await d.type("Review PR #142 before we merge: security, performance and test coverage, in parallel");
      await d.press("Enter");
      await d.caption("Each subagent runs in its own session");
      await d.waitFor(child("Test coverage review"), 30_000);
      await d.zoom(child("Performance review"), 1.6);
      await d.pause(2_400);
      await d.zoom();
      await d.caption("…and reports back when it's done");
      await d.waitFor({ contains: "All three reviews are in" }, 40_000);
      await d.pause(2_200);
      await d.caption("Open any subagent to see its work");
      await d.click(child("Security review"));
      await d.waitFor({ contains: "1 blocking issue" });
      await d.zoom({ contains: "1 blocking issue" }, 1.4);
      await d.pause(2_200);
      await d.zoom();
      await d.click({ label: "Open parent" });
      await d.caption("Watchers wait on CI for you");
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
    async run({ director: d }) {
      await d.caption("Bots are agents that stay: a face, one chat and a memory");
      await d.click({ css: "#sidebar-tab-bots" });
      await d.waitFor("Owl");
      await d.zoom({ css: ".bot-roster" }, 1.8);
      await d.pause(1_800);
      await d.zoom();
      await d.click({ css: ".bot-row__name", text: "Scout" });
      await d.caption("They schedule their own routines");
      await send(d, "Every weekday at 9, post a digest of open PRs and today's rollouts");
      await d.waitFor({ contains: "runs every weekday at 9:00" }, 30_000);
      await d.pause(1_000);
      await d.caption("Run one now, and it remembers what you told it");
      await d.click({ label: "Run now: Morning digest" });
      await d.waitFor({ contains: "Nothing is blocked" }, 30_000);
      await d.zoom({ contains: "Priya owns the rollback" , last: true }, 1.4);
      await d.pause(2_200);
      await d.zoom();
      await d.caption("Its memory is yours to read");
      await d.click({ css: ".bot-panel__tab[data-tab=memory]" });
      await d.pause(800);
      await d.still("memory");
      await d.zoom({ css: ".bot-panel__tab[data-tab=memory]" }, 1.5);
      await d.pause(2_400);
      await d.zoom();
      await d.caption();
    },
  },
];
