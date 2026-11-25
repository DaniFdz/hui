/**
 * The "Chiefs and their groups" clip: a new group that is its own Git project, the Chief of Staff the group gets, and
 * the sessions the chief starts for it. The scene and the scripted model's turns for it live together, so this clip's
 * scripts stay out of `provider.ts`'s shared list: its `scripts` array spreads `chiefsScripts` last.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Script } from "./provider.ts";
import type { Director, Target } from "./record.ts";
import type { Scene } from "./scenes.ts";

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The demo workspace's copy of the team's referral services, made in `setup`; `run` types its path into the group's
 * Working directory. */
let referralRepo = "";

/** What the operator gives the chief: the outcome and the deadline, never the steps. */
const OUTCOME = "Ship the referral program by Friday: the invite API, the invite page, and the tests. Split it across sessions and keep them moving.";

/** The invite-code helper the group's repository starts with; the API child adds its link helper beside it. */
const INVITES = `/** Invite codes for the referral program: six characters from an order's number, so the same order always gets the same code. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function inviteCode(sequence) {
  let rest = Math.abs(Math.trunc(sequence));
  let code = "";
  for (let index = 0; index < 6; index++) {
    code = ALPHABET[rest % ALPHABET.length] + code;
    rest = Math.floor(rest / ALPHABET.length);
  }
  return code;
}
`;

const INVITES_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteCode } from "../src/invites.js";

test("an invite code is six characters, stable for the same order and different for the next", () => {
  assert.match(inviteCode(4821), /^[A-Z2-9]{6}$/u);
  assert.equal(inviteCode(4821), inviteCode(4821));
  assert.notEqual(inviteCode(4821), inviteCode(4822));
});
`;

/** The API child's work: the link helper beside the code, and the tests it writes for both. */
const INVITES_WITH_LINK = `${INVITES}
/** The shareable link for a code. */
export function inviteLink(code, origin = "https://acme.dev") {
  return origin + "/r/" + code;
}
`;

const INVITES_API_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteCode, inviteLink } from "../src/invites.js";

test("an invite link carries its code", () => {
  assert.equal(inviteLink(inviteCode(4821)), "https://acme.dev/r/" + inviteCode(4821));
});

test("a link can be built for the staging origin", () => {
  assert.equal(inviteLink("ABC234", "https://staging.acme.dev"), "https://staging.acme.dev/r/ABC234");
});
`;

/** The group's repository, made in `setup` the way `seed.ts` makes the demo's others. */
async function makeReferrals(workspace: string) {
  referralRepo = join(workspace, "referrals");
  const files: Record<string, string> = {
    "AGENTS.md": "# Referrals\n\nSmall services for the referral program. `node --test` runs the tests.\n",
    "package.json": "{ \"name\": \"referrals\", \"type\": \"module\", \"private\": true }\n",
    "src/invites.js": INVITES,
    "test/invites.test.js": INVITES_TEST,
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(referralRepo, path)), { recursive: true });
    await writeFile(join(referralRepo, path), content);
  }
  const git = (...args: string[]) => execFileSync("git", ["-C", referralRepo, ...args], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  for (const [key, value] of [["user.name", "Acme"], ["user.email", "dev@acme.test"], ["commit.gpgsign", "false"], ["core.hooksPath", "/dev/null"]]) git("config", key!, value!);
  git("add", ".");
  git("commit", "-q", "-m", "Invite codes for the referral program");
}

/** Scrolls an element the clip is about to use into view, with the glide a reader makes: the sidebar's list is longer
 * than the window once the group has its sessions. */
async function bring(d: Director, selector: string, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const drawn = await d.stage<boolean>(`Boolean(document.getElementById("app").contentDocument?.querySelector(${JSON.stringify(selector)}))`);
    if (drawn) break;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${selector} to be drawn.`);
    await sleep(200);
  }
  await d.stage(`document.getElementById("app").contentDocument?.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center", behavior: "smooth" })`);
  await d.pause(800);
}

/** Brings an element to the middle of the transcript. The chat follows its last row, and a scripted smooth scroll from
 * the bottom is re-pinned before it leaves HUI's 48px bottom zone; a run of small scrolls is what a reader does, and the
 * first one already counts as reading further up. A transcript shorter than the view cannot centre its top rows: it stops
 * where the scroll stops, and the camera's zoom does the rest. */
async function centre(d: Director, target: Target) {
  await d.waitFor(target);
  const deadline = Date.now() + 20_000;
  let previous = Number.NaN;
  for (;;) {
    const box = await d.find(target);
    if (!box) throw new Error("The element to centre is no longer in the transcript.");
    const offset = box.y + box.height / 2 - 300;
    if (Math.abs(offset) < 40) return;
    const top = await d.stage<number>(`document.getElementById("app").contentDocument?.querySelector(".chat-thread")?.scrollTop ?? -1`);
    // The scroll stopped moving: the element sits where the transcript's edges put it.
    if (top === previous) return;
    previous = top;
    await d.stage(`document.getElementById("app").contentDocument?.querySelector(".chat-thread")?.scrollBy(0, ${Math.round(offset / 2)})`);
    await d.pause(150);
    if (Date.now() > deadline) throw new Error("The transcript did not reach the element to centre.");
  }
}

/** The transcript follows a new reply while it reads at the bottom; after looking further up, a reader taps Scroll to
 * latest to get back. */
async function latest(d: Director) {
  if (await d.find({ css: ".chat-scroll-to-bottom[data-visible='true']" })) {
    await d.click({ label: "Scroll to latest" });
    await d.pause(700);
  }
}

/** Waits until the chat stops growing: a row that lands while the camera reads snaps the transcript back to the
 * bottom, and the chief's reply is the last row this clip reads there. */
async function settledChat(d: Director, quietMs = 2_500, timeout = 120_000) {
  const rows = () => d.stage<number>(`document.getElementById("app").contentDocument?.querySelectorAll(".chat-group").length ?? 0`);
  const deadline = Date.now() + timeout;
  let count = await rows(), since = Date.now();
  for (;;) {
    await sleep(300);
    const next = await rows();
    if (next !== count) { count = next; since = Date.now(); }
    else if (Date.now() - since >= quietMs) return;
    if (Date.now() > deadline) throw new Error("The chief's chat never settled.");
  }
}

/** Opens the chief's activity trail, the one disclosure HUI folds a turn's calls into: a call's row is drawn only while
 * it is open. A settling turn can re-render the row under a new id, which folds the trail again, so the open is repeated
 * until the third row is drawn rather than trusted from one click. */
async function showCalls(d: Director, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await d.find({ css: ".tool-call-row", nth: 2 })) return;
    const open = await d.stage<boolean>(`Boolean(document.getElementById("app").contentDocument?.querySelector(".chat-activity-trail")?.open)`);
    if (!open) {
      // The transcript can move under the cursor while it glides: click where the head is now, then let the loop check
      // that the trail opened instead of blocking on a click that missed.
      const head = await d.find({ css: ".chat-activity-trail__head", last: true });
      if (head) await d.click({ x: head.x + head.width / 2, y: head.y + head.height / 2 });
    }
    if (Date.now() > deadline) throw new Error("The chief's activity trail never listed its three rows.");
    await sleep(300);
  }
}

/** Waits until the trail's three rows have all answered and its header says so: the completed rows the clip reads. A
 * settled call's row carries `data-status="succeeded"`; `running` is the spinner and `failed` the alert. */
async function callsDone(d: Director, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    await showCalls(d);
    if (await d.find({ css: `.tool-call-row[data-status="succeeded"]`, nth: 2 })
      && await d.find({ css: ".chat-activity-trail__label", contains: "Worked for" })) return;
    if (Date.now() > deadline) throw new Error("The chief's three calls did not draw as completed rows.");
    await sleep(400);
  }
}

/** Waits until a hovered message's footer, which carries the sender's name, is painted: HUI keeps the tag transparent
 * until a reader points at that message, and a frame has to prove the tag rather than a transparent element. `contains`
 * picks the message, so the check reads the footer the camera is on. */
async function senderShown(d: Director, contains: string, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const opacity = await d.stage<number>(`(() => {
      const doc = document.getElementById("app").contentDocument;
      const message = [...(doc?.querySelectorAll(".chat-group--peer") ?? [])].find((element) => (element.innerText ?? "").includes(${JSON.stringify(contains)}));
      const footer = message?.querySelector(".chat-group-footer");
      return footer ? Number(getComputedStyle(footer).opacity) : -1;
    })()`);
    if (opacity > 0.9) return;
    if (Date.now() > deadline) throw new Error(`The sender's name did not appear on hover (opacity ${opacity}).`);
    await sleep(100);
  }
}

/** Waits for the three children's own stages: Testing for the API, Implementation for the page, Investigation for the
 * tests. Only the first two changed value: the tests child sits in Investigation by default, and only its own
 * `set_stage` says so. A collapsed group hides its rows, so the caller opens it first. */
async function waitForStages(d: Director, timeout = 180_000) {
  const stages = ["testing", "implementation", "investigation"];
  const deadline = Date.now() + timeout;
  for (;;) {
    const shown = await Promise.all(stages.map((stage) => d.find({ css: `[data-session-group="Referrals"] [data-session-stage="${stage}"]` })));
    if (shown.every(Boolean)) return;
    await d.stage(`document.getElementById("app").contentDocument?.querySelector('[data-session-group="Referrals"]')?.scrollIntoView({ block: "center" })`);
    if (Date.now() > deadline) throw new Error(`The Referrals sessions did not reach ${stages.join(", ")}.`);
    await sleep(400);
  }
}

/** Whether a joined tool output proves a green suite. Node's reporter prints `pass N` and `fail N` behind `ℹ` or `#`,
 * and TAP prints a failure as `not ok`: a pass count beside a failure is not a pass. */
function suitePassed(results: readonly string[]): boolean {
  const output = results.join("\n");
  return /\bpass [1-9]\d*\b/u.test(output)
    && !/\bfail [1-9]\d*\b/u.test(output)
    && !/^not ok\b/mu.test(output);
}

/** The clip's scripted model turns: the chief's delegation and the three sessions it starts, each with its own brief.
 * A child's `when` appears only in its own brief, and no earlier script's `when` is part of these briefs. */
export const chiefsScripts: Script[] = [
  {
    when: "Ship the referral program by Friday",
    turns: [
      {
        wait: 1_400,
        think: "Three pieces, three sessions: the API, the page, the tests. I keep the rollout.",
        calls: [
          { name: "create_session", input: {
            title: "Invite API",
            branchName: "feat/invite-api",
            watch: false,
            prompt: "Build the invite API for the Referrals group. Read src/invites.js first, add an inviteLink(code, origin) helper beside inviteCode, cover both in test/invites-api.test.js, and run `node --test` in your worktree. Report the output you saw; never claim a pass you did not see.",
          } },
          { name: "create_session", input: {
            title: "Invite page",
            branchName: "feat/invite-page",
            watch: false,
            prompt: "Build the invite page for the referral program: one screen with the customer's invite code, its link and a copy button. Start with src/invite-page.js and keep the copy short enough to read at a glance. Report the files you add.",
          } },
          { name: "create_session", input: {
            title: "Invite tests",
            branchName: "feat/invite-tests",
            watch: false,
            prompt: "Cover the referral flow with tests: an invite code for a new order, a code reused by a second order, and one that has expired. Read test/invites.test.js first, then write the cases you would want before calling it covered, and say what each test proves.",
          } },
        ],
      },
      {
        // The chief reads the three results before it writes: the pause keeps its chat still while the clip holds on
        // the card the calls fold into, and the rows are all the easier to read.
        wait: 2_500,
        say: "Three sessions are up: **Invite API**, **Invite page** and **Invite tests**, each in its own worktree.\n\nI keep the Friday rollout.",
      },
    ],
  },
  {
    when: "Build the invite API",
    turns: [
      { wait: 900, think: "The repository already has the code helper; let me read it before adding the link.", calls: [{ name: "read", input: { path: "src/invites.js" } }] },
      { wait: 800, calls: [{ name: "write", input: { path: "src/invites.js", content: INVITES_WITH_LINK } }] },
      { wait: 800, calls: [{ name: "write", input: { path: "test/invites-api.test.js", content: INVITES_API_TEST } }] },
      { wait: 800, calls: [{ name: "bash", input: { command: "node --test", timeout: 60 } }] },
      { wait: 600, calls: [{ name: "set_stage", input: { stage: "testing" } }] },
      // A session a chief started reports to its chief the moment it stops, and the clip reads the chief's chat just
      // after its reply: this session keeps working until that beat is over, then gives the report the clip waits for.
      { wait: 20_000, say: (results) => suitePassed(results)
        ? "The invite link is in `src/invites.js`, covered by `test/invites-api.test.js`. `node --test` passed, so this is ready for review."
        : `The suite did not pass, so this is not ready: ${(results.find((result) => /\bpass \d/u.test(result)) ?? results[0] ?? "").slice(-200)}` },
    ],
  },
  {
    when: "Build the invite page",
    turns: [
      { wait: 800, calls: [{ name: "set_stage", input: { stage: "implementation" } }] },
      // The page is a longer job than the clip: its session is still working when the clip ends, so it never goes idle
      // and reports a heartbeat into the chief's chat while the clip reads it.
      { wait: 180_000, say: "The invite page is next: the code, its link and a copy button on one screen, built in `src/invite-page.js` with the group's short copy." },
    ],
  },
  {
    when: "Cover the referral flow",
    turns: [
      { wait: 800, calls: [{ name: "set_stage", input: { stage: "investigation" } }] },
      // As for the page: still working when the clip ends, so the chief's chat stays its own three-session reply.
      { wait: 180_000, say: "Mapping the referral flow before I write cases: a code for a new order, a reused code, and one that has expired." },
    ],
  },
];

export const chiefsScene: Scene = {
  name: "chiefs",
  chapter: "Chiefs and their groups",
  viewport: [1280, 720],
  ready: "Apple Pay at checkout",
  narration: {
    group: "In H U I, a group is a project of its own: one directory, and a fresh worktree for every session it starts.",
    chief: "Then it gets a Chief of Staff, with the group's project as its context.",
    delegate: "Give it the outcome, not the steps. It writes each brief, and starts the sessions itself.",
    sessions: "Three sessions, three worktrees. Each does its part, and the group shows where it stands.",
    watch: "The group holds them all, in the sidebar. Open any session to see what it was asked.",
  },
  /** A new group's directory has to be a real Git project before the New group dialog can offer its Environment. Its
   * path is short enough to type: the demo workspace is /tmp/acme-XXXX. */
  async setup({ api }) {
    const snapshot = await api("GET", "/__hui/sessions") as { groups: { sessions: { title: string; cwd: string }[] }[] };
    const seeded = snapshot.groups.flatMap((group) => group.sessions).find((session) => session.title === "Apple Pay at checkout");
    if (!seeded?.cwd) throw new Error("The demo workspace's seeded session is missing from the session list.");
    await makeReferrals(dirname(seeded.cwd));
  },
  async run({ director: d }) {
    await d.caption("A group is a project of its own");
    await d.say("group");
    await d.click({ css: "[data-new-group-trigger]" });
    await d.waitFor({ css: ".hui-modal-dialog.group-action-dialog", contains: "New group" });
    await d.pause(1_800);
    await d.click({ css: "input[name='name']" });
    await d.type("Referrals");
    await d.click({ css: "#group-default-cwd" });
    await d.type(referralRepo);
    await d.pause(1_200);
    // Typing opens the directory suggestions, which can cover the form; while it is expanded the input keeps Escape to
    // itself, so the dialog stays open and the list closes.
    await d.press("Escape");
    const expanded = await d.stage<string | null>(`document.getElementById("app").contentDocument?.querySelector("#group-default-cwd")?.getAttribute("aria-expanded") ?? null`);
    if (expanded !== "false") throw new Error(`The directory suggestions are still open (aria-expanded=${expanded ?? "missing"}).`);
    await d.pause(700);
    // The Environment picker only exists once the directory's Git read has landed; submit stays disabled until then.
    await d.waitFor({ css: "button.picker-select__trigger[aria-label^='Environment']" }, 30_000);
    await d.click({ css: "button.picker-select__trigger[aria-label^='Environment']" });
    await d.waitFor({ css: ".picker-select__option[data-value='worktree']" });
    await d.pause(900);
    await d.click({ css: ".picker-select__option[data-value='worktree']" });
    await d.pause(1_200);
    await d.click({ css: ".group-action-dialog .exec-approval-actions button[type='submit']" });
    await bring(d, '[data-session-group="Referrals"]');
    await d.waitFor({ css: '[data-session-group="Referrals"]' });
    await d.pause(2_500);

    await d.caption("Give the group its own chief");
    await d.say("chief");
    await bring(d, '[data-group-menu-trigger="Referrals"]');
    await d.waitFor({ css: '[data-group-menu-trigger="Referrals"]' });
    await d.stage("window.found?.scrollIntoView({ block: 'center', behavior: 'smooth' })");
    await d.pause(700);
    await d.click({ css: '[data-group-menu-trigger="Referrals"]' });
    await d.waitFor({ css: "wa-dropdown-item[value='chief']" }, 15_000);
    await d.pause(1_600);
    await d.click({ css: "wa-dropdown-item[value='chief']" });
    // Making the bot, its folder, its memory and its chat takes a moment; the clip opens on the ready chat.
    await d.cut(async () => {
      await d.waitFor({ css: "textarea[aria-label='Message']" }, 120_000);
      await d.waitFor({ text: "Chief of Staff · Referrals" }, 120_000);
    });
    await d.pause(2_200);

    await d.caption("Give it the outcome, not the steps");
    await d.say("delegate");
    await d.click({ css: "textarea[aria-label='Message']" });
    await d.type(OUTCOME);
    await d.pause(600);
    await d.press("Enter");
    await d.pause(2_800);
    // HUI folds a turn's calls into one card, and a row exists only while that card is open: open it as soon as the
    // three create_session calls have answered, while the chief is still reading their results, and hold on the rows.
    await callsDone(d);
    await d.pause(2_200);
    // Three sessions in three worktrees; the clip skips their creation and lands on the chief's ledger line.
    const ledger: Target = { contains: "I keep the Friday rollout." };
    await d.cut(async () => {
      await d.waitFor(ledger, 180_000);
      await settledChat(d);
      await callsDone(d);
    });
    await latest(d);
    // A settled turn folds its card again: open it after the cut and check the three completed rows are drawn.
    await callsDone(d);
    const card: Target = { css: ".tool-call-group", last: true };
    await centre(d, card);
    await callsDone(d);
    const rows = await d.find(card);
    const reply = await d.find(ledger);
    if (!rows || !reply) throw new Error("The chief's three completed rows or its ledger line are not on screen.");
    // The three rows and the chief's line about them in one frame: the camera centres on the space between them and
    // pulls back until both fit.
    const top = Math.min(rows.y, reply.y), bottom = Math.max(rows.y + rows.height, reply.y + reply.height);
    const factor = Math.min(1.5, Math.max(1.2, 520 / Math.max(1, bottom - top)));
    await d.zoom({ x: reply.x + Math.min(reply.width / 2, 420), y: (top + bottom) / 2 }, factor);
    await d.pause(5_000);
    await d.zoom();

    await d.caption("Three sessions, three worktrees");
    await d.say("sessions");
    await d.click({ css: "#sidebar-tab-sessions" });
    await bring(d, '[data-session-group="Referrals"]');
    for (const title of ["Invite API", "Invite page", "Invite tests"]) {
      await d.waitFor({ css: '[data-session-group="Referrals"] [data-testid="session-row"]', contains: title }, 60_000);
    }
    await d.pause(700);
    await d.zoom({ css: '[data-session-group="Referrals"]' }, 1.7);
    await d.pause(3_200);
    await d.zoom();

    await d.caption("Open one to see what it was asked");
    await d.click({ css: '[data-session-group="Referrals"] .session-row', contains: "Invite API" });
    await d.waitFor({ css: ".chat-group--peer", contains: "Build the invite API" }, 60_000);
    await d.waitFor({ css: ".chat-sender-link", text: "Chief of Staff · Referrals" }, 60_000);
    const brief: Target = { css: ".chat-group--peer", contains: "Build the invite API" };
    await centre(d, brief);
    // The tag that names the chief sits in the message's footer, which HUI paints on hover. Point at the brief once it is
    // centred, then move the camera: zooming keeps the pointer where it is, so the tag stays painted at the zoom.
    await d.move(brief);
    await senderShown(d, "Build the invite API");
    await d.zoom(brief, 1.6);
    await senderShown(d, "Build the invite API");
    await d.pause(3_500);
    await d.zoom();

    // The child's own report, then the three stages the group holds: the clip skips the work in between.
    await d.cut(async () => {
      await latest(d);
      await d.waitFor({ contains: "so this is ready for review." }, 180_000);
      // A collapsed group draws no children, so no stage to wait for: open it the way a reader does, once.
      if (await d.find({ css: '[data-session-group="Referrals"] .session-group__toggle[aria-expanded="false"]' })) {
        await d.click({ css: '[data-session-group="Referrals"] .session-group__toggle' });
        await d.waitFor({ css: '[data-session-group="Referrals"] .session-group__toggle[aria-expanded="true"]' }, 10_000);
      }
      await waitForStages(d);
    });
    await latest(d);
    await centre(d, { contains: "so this is ready for review." });
    await d.zoom({ contains: "so this is ready for review.", last: true }, 1.5);
    await d.pause(2_400);
    await d.zoom();

    await d.caption("Each session sets its own stage");
    await d.say("watch");
    await bring(d, '[data-session-group="Referrals"]');
    await d.waitFor({ css: '[data-session-group="Referrals"]' });
    // The clip closes on the group held at 1.7×, its three sessions and their three stages: only the caption leaves. The
    // screencast's 4K frames reach the encode about a second late, so the tail without it holds longer than that and the
    // clip does not end on a caption.
    await d.zoom({ css: '[data-session-group="Referrals"]' }, 1.7);
    await d.pause(3_000);
    await d.caption();
    await d.pause(2_500);
  },
};
