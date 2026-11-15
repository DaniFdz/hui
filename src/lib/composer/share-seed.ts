/**
 * The Share sheet's intake: a share opens `<gateway>/new-session?share=<encoded text or link>` in HUI, and this module
 * turns that query into the text the composer starts with. A link becomes one literal sentence naming the site it came
 * from, a plain text is kept as shared, and the whole seed is capped so one share can never hand the composer a
 * conversation's worth of text. It reads a search string, not `window`, so a test needs no browser.
 */

/** What one share may seed: the composer's text is cut on a character boundary past this many characters. */
export const SHARE_SEED_LIMIT = 8000;

/** A link starts on its scheme, after the start of the text or any character that cannot be part of a word before it,
 * so `xhttps://` is not one. The URL then runs to the next whitespace, exactly as shared. */
const SHARED_URL = /(?:^|[^\p{L}\p{N}_])(https?:\/\/\S+)/iu;

/** The sites that get a name in the sentence, by the host a share arrives with. */
const SITE_NAMES = new Map<string, string>([
  ["x.com", "X"],
  ["twitter.com", "X"],
  ["reddit.com", "Reddit"],
  ["redd.it", "Reddit"],
  ["youtube.com", "YouTube"],
  ["youtu.be", "YouTube"],
  ["instagram.com", "Instagram"],
]);

/** What a shared link's sentence starts with, then the site: `Look this post in X https://x.com/…`. */
const SHARED_LINK_LEAD = "Look this post in ";

/** The site a link came from: its name on the list, otherwise its bare host without a leading `www.`, so an unknown
 * site still reads as a place. Nothing when the text after the scheme is not an address. */
function siteName(url: string): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./iu, "");
  } catch {
    return undefined;
  }
  return SITE_NAMES.get(host) ?? host;
}

/** The seed the composer shows for a shared value, or nothing when the share carried no text. A link, the first one
 * in the text, becomes the sentence that names its site; a text with no link is kept as shared. */
export function shareSeedFromSearch(search: string): string | undefined {
  // URLSearchParams decodes the value once; a `+` that a hand-built link left unencoded is a space, as in any query.
  const shared = new URLSearchParams(search).get("share")?.trim();
  if (!shared) return undefined;
  const url = SHARED_URL.exec(shared)?.[1];
  const site = url ? siteName(url) : undefined;
  const seed = url && site ? `${SHARED_LINK_LEAD}${site} ${url}` : shared;
  // The cap counts characters, not UTF-16 units, so it never cuts a surrogate pair in half.
  return [...seed].slice(0, SHARE_SEED_LIMIT).join("");
}
