/* Documentation fixture for gateway extensions (docs/api.md): the routes the manual proof calls. */
export const routes = [
  {
    method: "GET",
    path: "hello",
    description: "Greets a name from the query.",
    handle: async ({ query }) => ({ body: { greeting: `hello, ${query.get("name") ?? "world"}` } }),
  },
  {
    method: "POST",
    path: "echo",
    description: "Echoes the JSON request body.",
    handle: async ({ body }) => ({ status: 201, body: { echo: body } }),
  },
  {
    method: "GET",
    path: "boom",
    description: "Throws, to show the contained failure path.",
    handle: async () => { throw new Error("fixture failure"); },
  },
];

/* Agent tools declared in extension.json; each handler is exported under the tool's name. */
export const tools = {
  greet: async ({ name }) => `hello, ${name}`,
};
