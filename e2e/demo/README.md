# Demo videos

`record.ts` records HUI's demo clips and the overview from this checkout:

```sh
node e2e/demo/record.ts                 # every clip, then overview.mp4
node e2e/demo/record.ts kanban bots     # only these clips
node e2e/demo/record.ts --out ~/Movies/hui-demo
node e2e/demo/record.ts bots --keep     # keep frames, logs and the demo HUI's folders
```

Needs ffmpeg with libx264 and a Chromium-family browser (the same one the agent
browser tool finds). Output goes to `$TMPDIR/hui-demo-videos` unless `--out`
says otherwise: one 1920×1080, 30 fps MP4 per clip, `overview.mp4` (every clip
at 1.2× speed, under 10 MB for GitHub attachments) and window-only PNG stills
for the README. Videos and stills never go into Git.

## How it works

- Each clip launches a fresh `e2e/visual-verification.mjs launch --demo`: real
  HUI, Pi Durable and tools, isolated state, the fake GitHub CLI, and a scripted
  model (`provider.ts`) instead of a real one. `seed.ts` creates the demo world:
  small Git repositories under `/tmp/acme-*`, sessions across Kanban stages,
  backlog tasks and GitHub pull requests.
- Headless Chrome opens `stage.html` (served by the verification server at
  `/__demo/stage`, so HUI's widgets accept their ancestors) with HUI in an
  iframe, and `record.ts` drives it with real mouse and keyboard input through
  CDP while a synthetic cursor, captions and camera zoom are drawn on the stage.
  Screencast frames are encoded with ffmpeg.
- `scenes.ts` holds the clips. A scene's prompts must match a script's `when`
  in `provider.ts`; scripts run tools for real, so file paths and commands must
  work in the seeded repositories.

## Changing a clip

Edit the scene and its script, then record only that clip. A failed step saves
`<scene>-failed.png` in the output directory; `HUI_DEMO_DEBUG=1` logs each wait
and slow CDP call. Waits synchronize on visible text or elements; `pause` is
pacing for the viewer and `cut` skips a wait the viewer should not sit through.
`npm test -- e2e/demo/provider.test.ts` checks the scripted model.
