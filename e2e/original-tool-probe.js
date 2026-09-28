/** Independent original tool-card renderer; real normalized PI fixture input. */
import { VISUAL_PROPERTIES } from "./visual-style-probe.js";
import { applyOriginalTheme } from "./original-theme-probe.js";

export async function compareOriginalTool(oracle = "http://127.0.0.1:43130", toolIndex = 0) {
  const item = document.querySelector("hui-app").transcript.filter((item) => item.kind === "tool" && item.name !== "progress_card")[toolIndex];
  const inputSnapshot = JSON.stringify(item);
  const live = document.querySelectorAll(".chat-tool-msg-collapse")[toolIndex];
  if (!item || !live?.getClientRects().length) throw new Error("Expand a real fixture tool activity first");
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", left: "0", top: "0", width: `${innerWidth}px`, height: `${innerHeight}px`, opacity: "0", pointerEvents: "none", border: "0" });
  frame.srcdoc = `<!doctype html><html><head><link rel="stylesheet" href="${oracle}/assets/control-ui-core-DvoiO6cr.css"><link rel="stylesheet" href="${oracle}/assets/control-ui-boot-shared-BahwINek.css"><link rel="stylesheet" href="${oracle}/reference-state.css"></head><body><section class="chat"><div class="chat-group tool"><div id="fixture" class="chat-activity-group__body"></div></div></section></body></html>`;
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  try {
    await loaded;
    const doc = frame.contentDocument;
    await applyOriginalTheme(doc, oracle);
    const { chat, render } = await doc.defaultView.eval(`Promise.all([import("${oracle}/assets/hui-original-chat-audit.js"),import("${oracle}/assets/lit-runtime-CIjzngcy.js")]).then(([chat,lit])=>({chat,render:lit.et}))`);
    chat.auditInitTranscript();
    const fixture = doc.getElementById("fixture");
    fixture.style.width = `${live.parentElement.clientWidth}px`;
    const card = { id: item.id, name: item.name, args: item.args, inputText: JSON.stringify(item.args, null, 2), outputText: item.output, completed: item.status === "succeeded" || item.status === "failed", isError: item.failed, live: item.status === "running" };
    render(chat.auditToolCard(card, { expanded: live.matches("[open],.is-open"), messageKey: "fixture", runActive: item.status === "running", showApprovalReviews: false, onToggleExpanded: () => {} }), fixture);
    await doc.fonts.ready;
    const selectors = [".chat-tool-msg-collapse", ".chat-tool-msg-summary", ".chat-tool-msg-summary__icon", ".chat-tool-msg-summary__icon svg", ".chat-tool-disclosure__content", ".chat-tool-row__verb", ".chat-tool-row__target", ".chat-tool-row__chevron", ".chat-tool-row__chevron svg", ".chat-tool-msg-body", ".chat-tool-card", ".chat-tool-card__header", ".chat-tool-card__detail", ".chat-tool-card__actions", ".chat-tool-card__block", ".chat-tool-card__block-content", ".chat-tool-card__outcome", ".chat-tool-failure", ".chat-tool-card__block-label"];
    if (item.name === "bash") selectors.push(".chat-tool-row__prompt", ".chat-tool-row__cmd", ".chat-tool-term", ".chat-tool-term__cmd", ".chat-tool-term__prompt", ".chat-tool-term__cmd > code", ".chat-tool-term__out", ".chat-tool-kv", ".chat-tool-kv__row", ".chat-tool-kv__key", ".chat-tool-kv__value", ".chat-cmd--name", ".chat-cmd--str", ".chat-cmd--num", ".chat-cmd--flag", ".chat-cmd--op");
    for (const selector of selectors) {
      const a = selector === ".chat-tool-msg-collapse" ? live : live.querySelector(selector);
      const b = fixture.querySelector(selector);
      if (a && b) for (const state of ["hover", "focus", "focus-visible", "focus-within"]) b.toggleAttribute(`data-reference-${state}`, a.matches(`:${state}`));
    }
    doc.documentElement.getBoundingClientRect();
    await Promise.all(doc.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {})));
    const records = selectors.map((selector) => {
      const a = selector === ".chat-tool-msg-collapse" ? live : live.querySelector(selector);
      const b = fixture.querySelector(selector);
      if (!a && !b) return { selector, expectedAbsent: true, differences: {} };
      if (!a || !b) return { selector, differences: { missing: { hui: !a, original: !b } } };
      const hui = getComputedStyle(a), original = doc.defaultView.getComputedStyle(b);
      const differences = Object.fromEntries(VISUAL_PROPERTIES.filter((p) => hui.getPropertyValue(p) !== original.getPropertyValue(p)).map((p) => [p, { hui: hui.getPropertyValue(p), original: original.getPropertyValue(p) }]));
      if (a.childElementCount === 0 && b.childElementCount === 0 && a.textContent.trim() !== b.textContent.trim()) differences.text = { hui: a.textContent.trim(), original: b.textContent.trim() };
      return { selector, differences };
    });
    const current = document.querySelector("hui-app").transcript.filter((item) => item.kind === "tool" && item.name !== "progress_card")[toolIndex];
    if (JSON.stringify(current) !== inputSnapshot) throw new Error("Tool input/output changed during measurement; synchronize on a stable fixture signal");
    return { viewport: [innerWidth, innerHeight], state: live.matches("[open],.is-open") ? "expanded" : "collapsed", tool: item.name, records };
  } finally { frame.remove(); }
}

export async function auditOriginalReadTool() {
  const { click, waitFor } = await import("./visual-journey-probe.js");
  await waitFor(() => document.querySelector(".chat-activity-group"), "Activity not loaded");
  const activity = document.querySelector(".chat-activity-group");
  if (!activity.open) { activity.querySelector("summary").click(); await document.querySelector("hui-app").updateComplete; }
  const control = document.querySelector(".chat-tool-row__toggle");
  if (control.getAttribute("aria-expanded") === "true") { control.click(); await document.querySelector("hui-app").updateComplete; }
  const collapsed = await compareOriginalTool();
  await click("Read fixture.txt");
  const expanded = await compareOriginalTool();
  return { collapsed, expanded };
}

/** Toggle only visible application controls, never injected component state. */
export async function auditOriginalTool(toolIndex) {
  const { waitFor } = await import("./visual-journey-probe.js");
  const cards = () => document.querySelectorAll(".chat-tool-msg-collapse");
  await waitFor(() => cards()[toolIndex], "Fixture tool not rendered");
  const activity = cards()[toolIndex].closest(".chat-activity-group");
  if (activity && !activity.open) {
    activity.querySelector("summary").click();
    await document.querySelector("hui-app").updateComplete;
  }
  const control = () => cards()[toolIndex].querySelector(".chat-tool-row__toggle,button.chat-tool-msg-summary");
  if (!control()) throw new Error("Original manual tool disclosure is missing");
  control().scrollIntoView({ block: "center" });
  if (control().getAttribute("aria-expanded") === "true") {
    control().click();
    await document.querySelector("hui-app").updateComplete;
  }
  const collapsed = await compareOriginalTool(undefined, toolIndex);
  control().click();
  await document.querySelector("hui-app").updateComplete;
  const expanded = await compareOriginalTool(undefined, toolIndex);
  return { collapsed, expanded };
}
