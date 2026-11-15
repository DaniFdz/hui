# Bundled gateway extensions

Extensions in this directory ship inside HUI's package, next to `skills/`. A
config extension with the same id overrides one of these, and `hui extension
eject <id>` copies a bundled one into the config directory for editing.

`defaults.json` lists the ids a fresh config enables until the operator's
`extensions.json` exists. It is not an extension and is ignored by the scanner.
