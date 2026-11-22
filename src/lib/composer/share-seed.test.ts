import assert from "node:assert/strict";
import { test } from "vitest";

import { SHARE_SEED_LIMIT, shareSeedFromSearch } from "./share-seed.ts";

const shared = (value: string) => shareSeedFromSearch(`?share=${encodeURIComponent(value)}`);

test("a shared link becomes one sentence naming the site it came from", () => {
  const url = "https://x.com/danifdz/status/1987654321098765432";
  assert.equal(shared(url), `Look this post in X ${url}`);
  // The same sentence for every site HUI names, and the bare host for the rest, without a leading `www.`.
  assert.equal(shared("https://twitter.com/hui/status/1"), "Look this post in X https://twitter.com/hui/status/1");
  assert.equal(shared("https://www.reddit.com/r/hui/comments/abc/"), "Look this post in Reddit https://www.reddit.com/r/hui/comments/abc/");
  assert.equal(shared("https://redd.it/abc"), "Look this post in Reddit https://redd.it/abc");
  assert.equal(shared("https://youtu.be/dQw4w9WgXcQ"), "Look this post in YouTube https://youtu.be/dQw4w9WgXcQ");
  assert.equal(shared("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "Look this post in YouTube https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(shared("https://instagram.com/p/abc"), "Look this post in Instagram https://instagram.com/p/abc");
  assert.equal(shared("https://www.example.com/a?b=c"), "Look this post in example.com https://www.example.com/a?b=c");
});

test("a shared text with no link seeds the composer as it was shared", () => {
  assert.equal(shared("Remember to water the plants"), "Remember to water the plants");
  // Whitespace around the share is not the share.
  assert.equal(shareSeedFromSearch("?share=%20%20typed%20by%20hand%20%20"), "typed by hand");
  // Only http:// and https:// start a link; whatever else the text holds is words.
  assert.equal(shared("ftp://example.com/file does not count, nor example.com"), "ftp://example.com/file does not count, nor example.com");
});

test("the first link in a longer text wins, and the URL is kept exactly as shared", () => {
  assert.equal(
    shared("This is wild https://x.com/hui/status/42 and so is https://reddit.com/r/hui"),
    "Look this post in X https://x.com/hui/status/42",
  );
  // A link runs to the next whitespace, so punctuation inside it is the share's, not HUI's to drop.
  assert.equal(shared("look at https://x.com/a, really"), "Look this post in X https://x.com/a,");
  // No normalising: the shared query, fragment and trailing slash survive untouched.
  assert.equal(shared("see https://www.x.com/a/b/?c=d#top"), "Look this post in X https://www.x.com/a/b/?c=d#top");
  // A scheme in capitals still starts a link.
  assert.equal(shared("HTTPS://X.COM/a"), "Look this post in X HTTPS://X.COM/a");
});

test("a share with nothing to seed leaves the composer alone", () => {
  assert.equal(shareSeedFromSearch(""), undefined);
  assert.equal(shareSeedFromSearch("?share="), undefined);
  assert.equal(shareSeedFromSearch("?share=%20%20"), undefined);
  assert.equal(shareSeedFromSearch("?other=value"), undefined);
});

test("a seed is capped on a character boundary", () => {
  assert.equal(shared("a".repeat(SHARE_SEED_LIMIT + 1)), "a".repeat(SHARE_SEED_LIMIT));
  // An emoji is two UTF-16 units: the cap counts characters, so every one of them arrives whole instead of the last
  // one being cut in half into a lone surrogate.
  const seed = shared("😀".repeat(SHARE_SEED_LIMIT + 1));
  assert.equal([...seed!].length, SHARE_SEED_LIMIT);
  assert.equal(seed, "😀".repeat(SHARE_SEED_LIMIT));
  assert.equal(seed!.length, SHARE_SEED_LIMIT * 2);
  // A long link keeps the site sentence and loses only what runs past the cap.
  const url = `https://x.com/${"a".repeat(SHARE_SEED_LIMIT)}`;
  const capped = shared(url)!;
  assert.equal(capped.length, SHARE_SEED_LIMIT);
  assert.ok(capped.startsWith("Look this post in X https://x.com/aaaa"));
});

test("the value is decoded once, so an encoded plus is a plus and a hand-built one is a space", () => {
  // The phone encodes what it shares (URLComponents, URLEncoder), so a plus it sends arrives as %2B and stays a plus.
  assert.equal(shareSeedFromSearch("?share=a%2Bb"), "a+b");
  assert.equal(shared("https://x.com/a?b=1+2"), "Look this post in X https://x.com/a?b=1+2");
  // A link typed by hand that left the plus alone reads as the query it is: a space, which ends the URL.
  assert.equal(shareSeedFromSearch("?share=a+b"), "a b");
  assert.equal(shareSeedFromSearch("?share=https://x.com/a?b=1+2"), "Look this post in X https://x.com/a?b=1");
});
