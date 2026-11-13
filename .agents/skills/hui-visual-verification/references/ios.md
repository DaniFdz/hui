# iOS evidence

iOS proof is CI's. No Mac is needed to review an iPhone change, and none of this can be produced from a Linux checkout:
the shell is built and run on a macOS runner, and its screenshots come back as a job artifact. `mobile/AGENTS.md` owns
what the iOS shell does; this is where to look and what the pictures cannot say.

**Status at this branch's head: not landed.** WP5 of [`mobile/AGENTS.md`](../../../../mobile/AGENTS.md)
adds `mobile/ios/` and the `mobile / ios-smoke` job to `.github/workflows/mobile.yml`. Until it merges there is no iOS
build, no job and no artifact, so an iPhone claim has no evidence behind it and belongs under Proof gaps.

## Where the evidence is

1. **The job.** Open the CI run for the PR's HEAD commit (`gh run list --branch <branch>`, or the checks on the PR) and
   find `ios-smoke` in the Mobile workflow. Once it lands, a push to a `mobile/**` package branch runs it too, and its
   path filter is `mobile/**`, `capacitor.config.ts` and its own workflow, plus nightly (plan, section 7).
2. **The screenshots.** The `ios-smoke` job's uploaded artifacts are the captures of the app on an iOS simulator: the
   Connect page, the session list against the launcher's gateway and one streamed chat. Attach those files to the PR as
   they are; do not crop a simulator frame to look like a device screenshot.
3. **The job log** for the Xcode build, the simulator boot and the launch. A build that never reaches the app is a
   log failure, not a missing screenshot.

## What it can and cannot show

It shows that the shell builds and launches, that its runtime gateway URL reaches the WKWebView, that the Connect page
accepts the launcher's gateway, and that the gateway's own UI renders and streams a chat at an iPhone size.

It cannot show:

- any journey beyond that smoke: nothing in the job presses through settings, panes, dialogs or a second chat, and the
  simulator cannot be driven from a Linux checkout, so a case the job does not run is unproven;
- offline caching: WKWebView allows a service worker only with App-Bound Domains, which the shell does not set, so the
  installed offline shell and **Reload HUI** may be absent on iOS;
- native behaviour that needs a tap or the OS: notifications, the share sheet, the back gesture, the microphone
  permission, downloads, the status bar, rotation and dark mode;
- a real iPhone: the runner is a simulator, which shares the runtime but not the hardware, the battery or the
  performance of a device.

A change that needs any of these was verified once by the owner on the MacBook or the iPhone, or it stays a proof gap in
the PR. `webkit-phone` (WP6) is the shared suite in mobile WebKit on Linux: an iPhone rendering proxy for the web UI,
never evidence about the app.
