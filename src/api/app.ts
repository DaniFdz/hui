/** The `?open=app` hand-off, client side: asking the gateway to show this chat in the installed HUI desktop app,
 * which a browser cannot start itself without a click. */
import { fetchJson } from "./request.ts";

export async function openChatInApp(path: string): Promise<void> {
  await fetchJson("/__hui/app/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
}
