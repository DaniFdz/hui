/**
 * The block PI expands a `/skill:name` prompt into, split from the words around it, so the transcript can show
 * the skill a turn invoked instead of the wrapper PI writes for the model.
 */

export type ExpandedSkill = {
  name: string;
  /** The skill file the body came from; shown on hover, never trusted for anything else. */
  location: string;
  body: string;
  /** What the prompt said after the block: the turn's own instructions. */
  rest: string;
};

const SKILL_BLOCK = /^<skill name="([^"]+)" location="([^"]*)">\r?\n(?:References are relative to [^\n]*\r?\n+)?([\s\S]*?)(?:\r?\n)?<\/skill>\s*\r?\n?([\s\S]*)$/u;

/** Splits a prompt that starts with an expanded skill block; undefined for any other text. */
export function splitSkillBlock(text: string): ExpandedSkill | undefined {
  const match = SKILL_BLOCK.exec(text);
  if (!match) return undefined;
  return { name: match[1]!, location: match[2]!, body: match[3]!.trim(), rest: match[4]!.trim() };
}

/** The prompt without PI's wrapper, with the skill body kept so the transcript still explains the turn. */
export function expandedSkillText(skill: ExpandedSkill): string {
  return [skill.body, skill.rest].filter(Boolean).join("\n\n");
}
