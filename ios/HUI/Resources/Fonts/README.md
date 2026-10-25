These are the faces HUI bundles, the same ones the web loads from `public/fonts`: the eight interface, chat and code
faces plus HUI's Nerd Font symbols. iOS registers a font file with CoreText, which reads TrueType and OpenType, not the
woff2 subsets the web ships, so each file is one of those subsets decompressed. The licence of every face is its
OpenFont License text in `public/fonts`, and the symbols face carries the MIT and bundled icon-set licences of
`public/fonts/symbols-nerd-font-mono-LICENSE.txt`.

Rebuild one from the web's copy with fontTools and brotli, which `uv` fetches without installing anything:

    uvx --from fonttools --with brotli python -m fontTools.ttLib.woff2 decompress \
      -o ios/HUI/Resources/Fonts/geist.ttf public/fonts/geist-latin.woff2

The symbols face is cut down to the code points `public/fonts/symbols-nerd-font-mono.css` limits the web's copy to, and
renamed to HUI's own family so an installed copy of Symbols Nerd Font Mono cannot shadow it:

    uvx --from fonttools --with brotli python -m fontTools.ttLib.woff2 decompress \
      -o /tmp/symbols.ttf public/fonts/symbols-nerd-font-mono.woff2
    uvx --from fonttools --with brotli pyftsubset /tmp/symbols.ttf \
      --unicodes=U+23FB-23FE,U+2B58,U+E000-F8FF,U+F0000-FFFFD --layout-features='*' \
      --output-file=ios/HUI/Resources/Fonts/hui-nerd-font-symbols.ttf
    uvx --from fonttools python -c 'import sys
from fontTools.ttLib import TTFont
font = TTFont(sys.argv[1])
for record in font["name"].names:
    if record.nameID in (1, 3, 4, 6, 16):
        record.string = {1: "HUI Nerd Font Symbols", 3: "HUI Nerd Font Symbols", 4: "HUI Nerd Font Symbols",
                         6: "HUINerdFontSymbols-Regular", 16: "HUI Nerd Font Symbols"}[record.nameID]
font.save(sys.argv[1])' ios/HUI/Resources/Fonts/hui-nerd-font-symbols.ttf

Only the `-latin` subsets are bundled. A face whose family CoreText cannot answer for still draws the system face, so a
missing file shows up as a wrong face in the tests rather than a crash.