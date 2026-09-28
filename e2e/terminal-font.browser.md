# Terminal font preference

Verified 2026-09-25 using the Browser tool and the isolated SDK fixture:
`HUI_E2E_PORT=43415 NO_PROXY=localhost,127.0.0.1 npm run e2e:sdk`.
No operator sessions or settings were used.

1. At 1440×1000, open Settings from the sidebar, then Appearance → Typography.
2. Open the **Terminal font** picker. It uses the same themed picker as the
   Interface and Chat prose fonts and lists every suggested font, not only the
   current value. Type `DejaVu Sans Mono`, choose its "Use this local font" row,
   and reload. The value survives and the preview's computed font stack starts
   with it.
3. Exit Settings, create a fixture session in its disposable workspace, and use
   **Open terminal**. The real Ghostty canvas connects to a native PTY and its
   font option starts with `DejaVu Sans Mono`.
4. Return to Settings, choose `MesloLGS NF` from the picker, exit Settings and reopen
   the terminal. The same terminal ID is connected with the new font stack;
   changing the preference does not restart the shell.
5. Inspect Typography at 390×844 and 844×390. The field remains accessible and
   main, sections and settings rows have no horizontal overflow.
6. Capture and inspect desktop/mobile screenshots outside the repository;
   include them in the PR description. Browser reports zero page errors.

DejaVu Sans Mono is installed on the test browser host. MesloLGS NF is not:
its name persists correctly and the monospace fallback renders, but this run
cannot prove the appearance of that font's private-use Nerd Font glyphs.
The preview deliberately includes those glyphs so the user can check their font.

Validation: 678 tests passed; typecheck, production build and diff check passed.
Stop the isolated launcher after verification; its temporary state is disposable.

## Bundled Nerd Font symbols

Verified 2026-09-25 with the same isolated fixture (`HUI_E2E_PORT=43419`) on a
browser host with no Nerd Font installed. With **FiraCode Nerd Font Mono**
selected, the Typography preview draws its Powerline, folder and prompt icons from
the bundled `HUI Nerd Font Symbols` face (`document.fonts` reports it loaded). In
a real terminal, `cat` of a file containing U+E0B0, U+F07C, U+F120, U+F0001 and
U+E0A0 renders all five icons on the Ghostty canvas while text keeps the chosen
font stack. The desktop app loads the same gateway-served stylesheet and has no
font policy of its own; it was not launched in this headless run.
