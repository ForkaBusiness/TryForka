# Static, subset TTFs for the recipe PDF, made from the exact variable WOFF2 files the app
# ships (@fontsource-variable), at the settings the app uses on screen.
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.merge import Merger
from fontTools import subset

src, out = sys.argv[1], sys.argv[2]
FR = f'{src}/@fontsource-variable/fraunces/files'
FG = f'{src}/@fontsource-variable/figtree/files'
# Latin, Latin Extended, punctuation, fractions, degree, bullets, arrows, multiplication.
UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x250)) + list(range(0x2000, 0x2070)) + [0x2122, 0x2190, 0x2192, 0x2212, 0x2215, 0x00D7, 0x2153, 0x2154, 0x215B, 0x215C, 0x215D, 0x215E, 0x00BC, 0x00BD, 0x00BE]

def static(files, location, name):
    parts = []
    for f in files:
        font = TTFont(f)
        font.flavor = None
        inst = instancer.instantiateVariableFont(font, location)
        path = f'{out}/.{name}-{len(parts)}.ttf'
        inst.save(path)
        parts.append(path)
    merged = Merger().merge(parts) if len(parts) > 1 else TTFont(parts[0])
    opts = subset.Options(); opts.layout_features = ['kern', 'liga', 'frac', 'onum', 'lnum', 'tnum']; opts.name_IDs = ['*']; opts.notdef_outline = True
    sub = subset.Subsetter(opts); sub.populate(unicodes=UNICODES); sub.subset(merged)
    merged.save(f'{out}/{name}.ttf')
    import os
    for p in parts: os.remove(p)
    cmap = merged.getBestCmap()
    print(name, os.path.getsize(f'{out}/{name}.ttf') // 1024, 'KB', 'has ½ °', 0xBD in cmap, 0xB0 in cmap)

static([f'{FR}/fraunces-latin-full-normal.woff2', f'{FR}/fraunces-latin-ext-full-normal.woff2'], {'opsz': 144, 'SOFT': 50, 'WONK': 0, 'wght': 560}, 'Fraunces-Display')
static([f'{FG}/figtree-latin-wght-normal.woff2', f'{FG}/figtree-latin-ext-wght-normal.woff2'], {'wght': 400}, 'Figtree-Regular')
static([f'{FG}/figtree-latin-wght-normal.woff2', f'{FG}/figtree-latin-ext-wght-normal.woff2'], {'wght': 600}, 'Figtree-SemiBold')
