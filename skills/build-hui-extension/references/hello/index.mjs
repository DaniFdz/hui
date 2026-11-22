/** The Hello reference: one JSON route that the panel calls through the parent bridge. */
export const routes = [{
  method: "GET",
  path: "hello",
  description: "Greets a name.",
  handle: async ({ query }) => ({ body: { greeting: `hello, ${query.get("name") ?? "world"}` } }),
}];
