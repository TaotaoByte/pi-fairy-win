"""Own-view native rasters, not screenshots. Run after FAIRY_EFFECTS_PREVIEW GUI smoke."""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/fairy-effects-previews')
for size in ['xsmall', 'small', 'standard', 'large', 'xlarge']:
    for theme in ['dark', 'light']:
        frames = {name: Image.open(root / f'{size}-{theme}-{name}.png').convert('RGBA')
                  for name in ['rest', 'recovered', 'glitch', 'ripple-early', 'ripple-middle', 'ripple-late']}
        rest = frames['rest']
        assert rest.tobytes() == frames['recovered'].tobytes(), 'glitch recovery must exactly restore body'
        assert rest.tobytes() != frames['glitch'].tobytes(), 'glitch must displace actual art'
        w, h = rest.size
        for name, image in frames.items():
            alpha = image.getchannel('A')
            assert alpha.getpixel((0, 0)) == 0
            for box in [(0, 0, w, 2), (0, h-2, w, h), (0, 0, 2, h), (w-2, 0, w, h)]:
                assert alpha.crop(box).getextrema() == (0, 0), 'effect must fade before bounds'
            # Solid central disc has no missing horizontal rows/rectangular source gaps.
            if name == 'glitch':
                assert alpha.crop((int(w*.37), int(h*.37), int(w*.63), int(h*.63))).getextrema()[0] >= 250
        # Transparent annulus grows outside unchanged body, not scaling down the sprite.
        assert frames['ripple-middle'].getchannel('A').getbbox()[0] < rest.getchannel('A').getbbox()[0]
        for name in ['ripple-early', 'ripple-middle', 'ripple-late']:
            box = (int(w*.40), int(h*.40), int(w*.60), int(h*.60))
            assert frames[name].crop(box).tobytes() == rest.crop(box).tobytes()

names = ['rest', 'ripple-early', 'ripple-middle', 'ripple-late', 'glitch', 'recovered']
contact = Image.new('RGB', (6*280, 2*310))
for row, theme in enumerate(['dark', 'light']):
    for col, name in enumerate(names):
        tile = Image.new('RGB', (280,310), '#151923' if theme == 'dark' else '#eeeeee')
        image = Image.open(root / f'standard-{theme}-{name}.png').convert('RGBA')
        image.thumbnail((280,280))
        tile.paste(image, ((280-image.width)//2, 25), image)
        ImageDraw.Draw(tile).text((6,6), name, fill='white' if theme == 'dark' else 'black')
        contact.paste(tile, (col*280,row*310))
contact.save(root / 'contact.jpg')
print('PASS: 60 native rasters; exact rest/recovery, displaced art, no solid-disc gaps, transparent bounds, unchanged central geometry, expanding annulus; contact.jpg')
