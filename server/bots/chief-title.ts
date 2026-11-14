/** Which bots are chiefs of staff, and which chief supervises a session. */

/** Whether a bot's title marks it as a Chief of Staff: the seeded title, or a group chief's `Chief of Staff · <group>`. */
export function isChiefTitle(title: string | undefined): boolean {
  const value = title?.trim() ?? "";
  return value === "Chief of Staff" || /^Chief of Staff · .+$/u.test(value);
}

/** The chief that should start watching an Autonomous session: none while a chief's chat already watches it, else the
 * chief of its group, else a Chief of Staff of no group. Archived bots are never chiefs here. */
export function chiefToWatch<Bot extends { title?: string; group?: string; archived?: boolean; sessionId: string }>(
  bots: readonly Bot[],
  records: readonly { id: string; watches?: readonly string[] }[],
  session: { id: string; group: string },
): Bot | undefined {
  const chiefs = bots.filter((bot) => !bot.archived && isChiefTitle(bot.title));
  const watching = new Set(records.filter((record) => record.watches?.includes(session.id)).map((record) => record.id));
  if (chiefs.some((bot) => watching.has(bot.sessionId))) return undefined;
  return chiefs.find((bot) => session.group !== "" && bot.group === session.group) ?? chiefs.find((bot) => !bot.group);
}
