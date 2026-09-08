"""Offline Pillow previews of the generated PNGs (not terminal screenshots).
Generated visual derivatives carry Apache-2.0 Fairy-DSH attribution; see ../NOTICE.
"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]


def preview(frame):
    canvas = Image.new('RGB', (560, 304), '#181c28')
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((280, 0, 559, 303), fill='#f6f7fb')
    for i, (variant, ink) in enumerate([('dark', '#b8c3dc'), ('light', '#23304c')]):
        draw.text((i * 280 + 12, 10), f'{variant} / Fairy-DSH idle adaptation', fill=ink)
        image = Image.open(root / f'assets/frames/{variant}/{frame:03}.png').convert('RGBA')
        canvas.paste(image, (i * 280 + 12, 36), image)
    return canvas


preview(0).save(root / 'docs/vector-preview.png')
frames = [preview(frame).quantize(colors=256, dither=Image.Dither.NONE) for frame in range(120)]
frames[0].save(root / 'docs/vector-idle.gif', save_all=True, append_images=frames[1:],
               duration=50, loop=0, disposal=2, optimize=False)
print('Generated labelled dark/light PNG and 120-frame 6s GIF previews (opaque preview backgrounds only)')
