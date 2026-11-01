# Terminal font in shared terminals

The Terminal font picker, a typed local family, its persistence, the bundled Nerd Font symbols in the stack and the
fallback to JetBrains Mono are proven by the shared test `e2e/tests/set/typography.e2e.ts` (SET-010). What is left
here is SET-077: a shared terminal draws on a canvas in a worker, which no shared test reads yet.

Run it with the default launcher (`node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"`)
and the Browser tool. No operator sessions or settings are used.

1. In Settings → Appearance → Typography, type `DejaVu Sans Mono` in the **Terminal font** picker and choose its
   "Use this local font" row.
2. Exit Settings, create a fixture session in the launcher's workspace, and use **Open terminal**. The Ghostty
   canvas connects to a native PTY and its font option starts with `DejaVu Sans Mono`.
3. Return to Settings, choose `MesloLGS NF`, exit Settings and reopen the terminal. The same terminal ID is
   connected with the new font stack; changing the preference does not restart the shell.
4. With **FiraCode Nerd Font Mono** chosen on a browser host with no Nerd Font installed, `cat` a file holding
   U+E0B0, U+F07C, U+F120, U+F0001 and U+E0A0: the canvas draws all five icons from the bundled
   `HUI Nerd Font Symbols` face while text keeps the chosen font stack.
5. Browser page errors: none.
