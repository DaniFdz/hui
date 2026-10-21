/** GitHub's heading anchors for a Markdown document, which the catalogue's `SPEC.md#…` and `docs/api.md#…` references use. */
export function githubAnchors(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const found = new Set<string>();
  for (const [, heading] of markdown.matchAll(/^#{1,6} (.+)$/gmu)) {
    const slug = heading!.trim().replaceAll("`", "").toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/gu, "-");
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    found.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return found;
}
