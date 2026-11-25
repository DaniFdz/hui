---
name: hui-release-video
description: "Film HUI's demo video for a release: find the new user-visible features, script captioned silent clips for them with the scripted demo agent, record them with e2e/demo/record.ts, review them, and attach one clip per feature to the release PR and GitHub Release. Use when preparing a release (a `chore: release vX.Y.Z` PR) or when asked to film or update HUI's demo videos."
---

# HUI release video

Every release that adds user-visible features ships with a short captioned,
silent video of them: captions and picture, with no audio. Releases with only
fixes, tests, docs or chores get none; say so in the release PR. The tool is
`e2e/demo/record.ts`; read `e2e/demo/README.md` for how it works. Resolve paths
from the checkout containing this skill.

## 1. Decide what to film

```sh
TAG=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' origin/main)
git log --no-merges --format='%h %s' "$TAG"..origin/main | grep -E '^[0-9a-f]+ feat'
```

Keep the features a user would notice and group them into one to three clips.
Read `e2e/demo/scenes.ts`: when a scene already covers the area, extend it
instead of adding a near-duplicate. Ask the owner when the choice is unclear.

**Done:** a list of clips, each with the features it shows.

## 2. Check the tools

- ffmpeg with libx264, and a Chromium-family browser.
- A clip with `vscode: true` needs `--accept-vscode-license`, which accepts
  Microsoft's VS Code Server license for the throwaway demo HUI. Pass it only
  with the operator's consent.
- A quiet machine: under load the screencast drops frames and motion stutters.
  Wait until `sysctl -n vm.loadavg` (or `uptime`) shows a load below about
  three quarters of the core count.

## 3. Script the clips

In a feature branch from `origin/main`:

- `scenes.ts`: a `chapter` (two or three words), where it opens (`path`, `ready`)
  and `run`: a `caption` (three to seven words) per step, then real
  `click`/`type`/`drag`/`swipe` input, `zoom` on the detail and `cut` for waits
  the viewer should not sit through. Nothing speaks for a beat, so hold it long
  enough to read: a `pause`, or a `cut` that lands on the framed picture.
  `device: "phone"` films the phone layout with touch input (tap the send button;
  Return adds a line there).
- `provider.ts`: the scripted agent's turns, keyed by the prompt's `when`. Its
  tool calls run for real, so they must work in the repositories `seed.ts` creates.
  A script that cannot go on throws; never fake a result.
- `seed.ts`: any sessions, backlog items or files the clip starts from.

Wait for visible state, never for time. Record one clip at a time while you
iterate (`node e2e/demo/record.ts <scene>`); a failure saves
`<scene>-failed.png` and `HUI_DEMO_DEBUG=1` logs every wait.

## 4. Review before anyone else sees it

"It ran" proves nothing about how it looks.

- Look at frames: `ffmpeg -ss <t> -i clip.mp4 -vf "fps=0.5,scale=960:-1,tile=2x2" -frames:v 1 sheet.png`
  across the whole clip. Check that the zoom frames its subject, captions do not
  cover what is being shown, nothing private appears (repositories live in
  `/tmp/acme-*`, the address bar says localhost) and every step happened.
- Read the captions in the sheets: one sheet covers eight seconds at `fps=0.5, tile=2x2`, so
take one sheet per eight seconds of a clip (`-ss <t>` for each) until the whole
clip is covered. Every caption in order, each over the picture it describes, not
covering the subject, and each beat on screen long enough to read.
- `ffprobe` each file: it has no audio stream (`-an`), its picture holds on its
  last frame, wide and with no caption, and its size fits GitHub's limit: videos
  up to 100 MB on the owner's paid plan (10 MB on a free one). Look at a frame at
  full size too: text must be sharp.

## 5. Publish

1. Commit the new scenes, open their PR (`feat:` or `docs:`) with the clips
   attached to its description (`gh pr edit <n> --attach clip.mp4`; the account
   needs write access), and merge it before the release.
2. From the merged `main`, record the release's clips together:
   `node e2e/demo/record.ts <scenes> --out <dir>`.
   It also joins them into `overview.mp4`; hand that to the owner for sharing
   outside GitHub. On GitHub every feature gets its own player.
   When the README's videos no longer show HUI as it is, record every scene
   and update its "See it in action" section (a heading, one line and the clip
   per feature) in a `docs:` PR, never in the release commit.
3. Attach the release's clips to the version-bump PR's description under
   **Release video**: a `###` heading per feature with its clip's URL on its own
   line, where GitHub shows a player.
4. Once the Release workflow has published `vX.Y.Z`, and with the owner's
   go-ahead, put the same headings and URLs at the top of its notes:
   `gh release view vX.Y.Z --json body -q .body > notes.md`, add
   `## What's new` with them, then `gh release edit vX.Y.Z --notes-file notes.md`.

Videos never go into Git.

**Done:** the release PR and the GitHub Release show the video, and the frames,
captions and sizes were checked.
