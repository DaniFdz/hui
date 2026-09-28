# Media viewer browser journey

## Journey

1. Launch the isolated instance with `node e2e/visual-verification.mjs launch`.
   Put `media-sample.png`, `media-sample.mp4`, `media-sample.mp3` and
   `media-notes.pdf` in the printed workspace (for example generated with
   ffmpeg); `E2E_PRESENT_MEDIA` presents those exact paths.
2. Create a session with `E2E_RICH_EMBEDS`, then send `E2E_PRESENT_MEDIA`.
3. Mermaid: click the rendered diagram, and separately its expand control and
   Enter on the focused embed. Each opens the viewer with the diagram fitted.
4. In the viewer, use Zoom in/out, the zoom level (fit), `+`/`-`/`0`/`1` and
   arrow keys; wheel over a point, drag and double-click the drawing. Escape and
   a click on the empty backdrop close it and return focus to the embed.
5. Copy image reports **Image copied**. Save as SVG downloads
   `mermaid-diagram.svg`; rendering that file as a standalone image must show
   unclipped labels. Copy source copies the fenced Mermaid text.
6. Image: click the presented PNG. The page must not navigate or open a tab; the
   viewer fits the whole image, Save image downloads a byte-identical file and
   Open in new tab remains available for non-`data:` sources.
7. Repeat opening at 390×844. With touch emulation, a two-finger pinch zooms
   around its midpoint and a following one-finger drag only pans.

## Notes

The Browser tool has no wheel, drag or touch action; those gestures were sent
as CDP `Input.dispatchMouseEvent`/`Input.dispatchTouchEvent` to the owned tab.
Clipboard contents cannot be read back in the managed profile (read permission
denied), so copy proof is the resolved async-clipboard write and its status.

Follow the [visual verification skill](../.agents/skills/hui-visual-verification/SKILL.md)
for fresh desktop/mobile evidence in the PR description, outside Git history.
