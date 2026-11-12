/** Which bots are chiefs of staff, and which chief supervises a session. */

/** Whether a bot's title marks it as a Chief of Staff: the seeded title, or a group chief's `Chief of Staff · <group>`. */
export function isChiefTitle(title: string | undefined): boolean {
  const value = title?.trim() ?? "";
  return value === "Chief of Staff" || /^Chief of Staff · .+$/u.test(value);
}

/** The chief that supervises a session of `group`: that group's chief, else a Chief of Staff of no group. */
export function chiefFor<Bot extends { title?: string; group?: string; archived?: boolean }>(bots: readonly Bot[], group: string): Bot | undefined {
  const chiefs = bots.filter((bot) => !bot.archived && isChiefTitle(bot.title));
  return chiefs.find((bot) => group !== "" && bot.group === group) ?? chiefs.find((bot) => !bot.group);
}
