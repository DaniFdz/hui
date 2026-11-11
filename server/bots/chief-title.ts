/** Whether a bot's title marks it as a Chief of Staff: the seeded title, or a group chief's `Chief of Staff · <group>`. */
export function isChiefTitle(title: string | undefined): boolean {
  const value = title?.trim() ?? "";
  return value === "Chief of Staff" || /^Chief of Staff · .+$/u.test(value);
}
