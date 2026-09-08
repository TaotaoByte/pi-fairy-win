"""Offline raster checks: python3 tests/check-assets.py (requires Pillow)."""
import json
from math import hypot
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image, ImageChops, ImageStat

root = Path(__file__).resolve().parents[1]
svg = ET.parse(root / 'assets/fairy.svg')
elements = {element.get('id'): element for element in svg.iter() if element.get('id')}
highlight = elements['catchlight-lower-right']
assert (float(highlight.get('cx')), float(highlight.get('cy')), float(highlight.get('r'))) == (98, 100.5, 11)
for name, radius in [('outer-halo-gradient', 79), ('sclera-halo-gradient', 56), ('highlight-halo-gradient', 18)]:
    gradient = elements[name]
    assert float(gradient.get('r')) == radius
    stops = list(gradient)
    assert float(stops[0].get('stop-opacity')) == float(stops[-1].get('stop-opacity')) == 0
    assert len(stops) >= 7, 'multi-stop soft falloff, not a hard outline'
    assert all(stop.get('stop-color') == ('#f5f8fd' if name.startswith('highlight') else '#ffffff') for stop in stops)

manifest = json.loads((root / 'assets/frames/manifest.json').read_text())
assert (manifest['count'], manifest['intervalMs']) == (120, 50)
dark = []
for frame in range(manifest['count']):
    images = [Image.open(root / f'assets/frames/{variant}/{frame:03}.png').convert('RGBA') for variant in ['dark', 'light']]
    for image in images:
        assert image.size == (256, 256)
        alpha = image.getchannel('A')
        assert alpha.getextrema() == (0, 255)
        assert alpha.getbbox() == (3, 3, 253, 253), 'halo has real padding; no bob/clipping'
        assert image.getpixel((0, 0))[3] == 0
        assert image.getpixel((128, 128))[3] == 255
        # White external halo must remain white in LIGHT too, with graded alpha.
        halo = [image.getpixel((x, 128)) for x in range(238, 253)]
        assert all(pixel[:3] == (255, 255, 255) for pixel in halo)
        assert all(0 < pixel[3] < 80 for pixel in halo)
        assert all(a[3] > b[3] for a, b in zip(halo, halo[1:])), 'continuous outward fade'
        # Body radius remains ~107px vs old 108px (not shrunken for a huge light field).
        assert image.getpixel((234, 128))[3] == 255
    assert images[0].getchannel('A').tobytes() == images[1].getchannel('A').tobytes()
    assert images[0].crop((64, 64, 192, 192)).tobytes() == images[1].crop((64, 64, 192, 192)).tobytes(), 'theme must not recolor the face'
    # Theme differences confined to thin support edge, never replacing the halo.
    diff = ImageChops.difference(images[0], images[1]).convert('RGB')
    pixels = diff.load()
    changed = [(x, y) for y in range(256) for x in range(256) if pixels[x, y] != (0, 0, 0)]
    assert changed and all(106 < hypot(x - 127.5, y - 127.5) < 111 for x, y in changed)
    assert sum(images[1].getpixel((236, 128))[:3]) < sum(images[0].getpixel((236, 128))[:3]) - 150
    dark.append(images[0])

# Raster-level movement: a >4px sclera radius excursion, not subpixel whole-body bob.
def sclera_edge(image):
    return max(x for x in range(180, 215) if min(image.getpixel((x, 128))[:3]) > 215)
assert sclera_edge(dark[0]) - sclera_edge(dark[15]) >= 4
# After a full breath, eye anatomy repeats but corners have turned 45 degrees.
assert dark[0].crop((80, 80, 176, 176)).tobytes() == dark[30].crop((80, 80, 176, 176)).tobytes()
assert dark[0].crop((45, 45, 211, 211)).tobytes() != dark[30].crop((45, 45, 211, 211)).tobytes()
assert len({image.tobytes() for image in dark}) == 60, '6s storage contains two exact 3s fundamental cycles'

def distance(a, b):
    return sum(ImageStat.Stat(ImageChops.difference(a, b).convert('RGB')).mean)
steps = [distance(dark[i], dark[(i + 1) % 120]) for i in range(120)]
assert min(steps) > 0.5, 'every adjacent frame changes meaningfully, no endpoint dwell'
assert steps[-1] < 1.3 * steps[0], 'loop seam is a normal step, not a cropped-motion jump'
assert abs(steps[59] - steps[119]) < 1e-9, 'square-angle wrap also seamless'
print(f'PASS: 240 RGBA PNGs; padded white halos both themes; thin contrast edge; >=4px sclera excursion; '
      f'45-degree corner motion; 60 distinct frames; seam RGB mean-sum {steps[-1]:.3f} vs first step {steps[0]:.3f}')
