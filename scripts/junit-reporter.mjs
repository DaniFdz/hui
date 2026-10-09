/** Wraps Node's JUnit output in a suite so standalone tests are discoverable by JUnit consumers. */
import { junit } from "node:test/reporters";

export default async function* junitReporter(source) {
  const timestamp = new Date().toISOString();
  let report = "";
  for await (const chunk of junit(source)) report += chunk;
  // Node emits standalone test() cases directly under <testsuites>. JUnit
  // importers expect <testsuites>/<testsuite>/<testcase>. Keep Node's escaping,
  // failure details and nested suites, and give all cases a containing suite.
  yield report
    .replace("<testsuites>", `<testsuites>\n<testsuite name="node:test" timestamp="${timestamp}">`)
    .replace(/<\/testsuites>\s*$/u, "</testsuite>\n</testsuites>\n");
}
