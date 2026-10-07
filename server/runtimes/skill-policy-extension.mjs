/**
 * Keeps skills the user disabled in HUI out of PI sessions: it strips their entries from the system prompt and
 * refuses their `/skill:` commands. The disabled list arrives in HUI_DISABLED_SKILLS; PI's skill files and
 * other context stay untouched.
 */
const disabledEntries = disabledSkillsFrom(process.env.HUI_DISABLED_SKILLS);

export function disabledSkillsFrom(raw) {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item) =>
      item && typeof item === "object" &&
      typeof item.name === "string" && item.name.length > 0 &&
      typeof item.path === "string" && item.path.length > 0
    );
  } catch {
    return [];
  }
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Remove only PI's structured skill entries; context files containing similar
 * prose are outside this exact XML envelope and remain untouched. */
export function filterDisabledSkills(systemPrompt, entries) {
  if (!entries.length) return systemPrompt;
  const blockedLocations = new Set(entries.map((skill) => escapeXml(skill.path)));
  const filtered = systemPrompt.replace(/\n?  <skill>\n[\s\S]*?\n  <\/skill>/gu, (block) => {
    const location = block.match(/<location>([\s\S]*?)<\/location>/u)?.[1];
    return location && blockedLocations.has(location) ? "" : block;
  });
  if (!/<available_skills>\s*<skill>/u.test(filtered)) {
    return filtered.replace(
      /\n\nThe following skills provide specialized instructions[\s\S]*?<available_skills>\s*<\/available_skills>/u,
      "",
    );
  }
  return filtered;
}

export function registerSkillPolicy(pi, entries) {
  if (!entries.length) return;
  const names = new Set(entries.map((skill) => skill.name));

  pi.on("before_agent_start", (event) => {
    const systemPrompt = filterDisabledSkills(event.systemPrompt, entries);
    return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
  });

  pi.on("input", (event, ctx) => {
    const name = event.text.match(/^\/skill:([^\s]+)(?:\s|$)/u)?.[1];
    if (!name || !names.has(name)) return { action: "continue" };
    ctx.ui.notify(`Skill “${name}” is disabled for HUI sessions.`, "warning");
    return { action: "handled" };
  });
}

export default function skillPolicyExtension(pi) {
  registerSkillPolicy(pi, disabledEntries);
}
