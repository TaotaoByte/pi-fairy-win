"""Offline accepted-asset/DSP and standalone-source checks; never plays audio."""
import array
import hashlib
import math
from pathlib import Path
import shutil
import runpy
import subprocess
import sys
import tempfile
import wave

root = Path(__file__).resolve().parents[1]
asset = root / 'assets/intro/sfx-v4.wav'
expected = 'fedff073eedfd00b039447dc885d71466538ec185618f7e6c0a65c6e0a5c83bc'
assert hashlib.sha256(asset.read_bytes()).hexdigest() == expected
with wave.open(str(asset)) as w:
    assert (w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes(), w.getcomptype()) == (48000, 2, 2, 480000, 'NONE')
    pcm = array.array('h', w.readframes(w.getnframes()))
if sys.byteorder != 'little':
    pcm.byteswap()
assert pcm[:2] == pcm[-2:] == array.array('h', [0, 0])
assert any(pcm[round(9.3 * 48000) * 2:round(9.9 * 48000) * 2:])
peak = 20 * math.log10(max(map(abs, pcm)) / 32768)
assert abs(peak - (-14.902269877291374)) < 1e-9
assert all(-32768 < v < 32767 for v in pcm)
for channel in (pcm[::2], pcm[1::2]):
    assert abs(sum(channel) / len(channel) / 32768) < 1e-4
source = root / 'scripts/generate-intro-sfx.py'
g = runpy.run_path(str(source))
foreground, ambient = g['make_foreground'](), g['make_ambient']()
assert len(foreground) == len(ambient) == len(pcm)
assert all(v == f + a for v, f, a in zip(pcm, foreground, ambient))
# Preserve the old foreground duck bound; measure the added bed independently.
assert max(map(abs, foreground[round(7.2 * 48000) * 2:])) / 32768 < 10 ** (-58 / 20)
def level(a, b):
    return 20 * math.log10(g['rms'](ambient[round(a*48000)*2:round(b*48000)*2])/32768)
assert abs(level(.5, 6.7) - (-42.5)) < .05
assert level(7.2, 8.8) < level(.5, 6.7) - 12
assert abs(level(9.3, 10) - (-66.32520283070038)) < 1e-9
assert g['gain'](0) == g['gain'](g['FADE_END']) == 0
assert abs(g['gain'](7.2) - .2) < 1e-12
for i in range(1001): assert 0 <= g['gain'](i/100) <= 1
# Smooth endpoint neighborhoods (quantized edges are zero, no hard cut).
assert max(map(abs, pcm[:480*2])) <= 1
assert max(map(abs, pcm[-480*2:])) <= 1
text = source.read_text()
for forbidden in ('/tmp/', '/Users/', 'resample_voice', 'VOICE_GAIN', 'with-welcome-preview', 'importlib'):
    assert forbidden not in text, forbidden
# Isolated package-shaped copy: only the editable source and accepted asset exist.
with tempfile.TemporaryDirectory(prefix='fairy-sfx-independent-') as directory:
    copied = Path(directory)
    (copied / 'scripts').mkdir()
    (copied / 'assets/intro').mkdir(parents=True)
    shutil.copyfile(source, copied / 'scripts/generate-intro-sfx.py')
    shutil.copyfile(asset, copied / 'assets/intro/sfx-v4.wav')
    subprocess.run([sys.executable, str(copied / 'scripts/generate-intro-sfx.py'), '--check'], cwd='/', check=True)
    assert len(list(copied.rglob('*.wav'))) == 1
    # --output must also work with source alone, without any input WAV.
    (copied / 'assets/intro/sfx-v4.wav').unlink()
    output = copied / 'generated.wav'
    subprocess.run([sys.executable, str(copied / 'scripts/generate-intro-sfx.py'), '--output', str(output)], cwd='/', check=True)
    assert output.read_bytes() == asset.read_bytes()
print(f'PASS accepted PCM16 stereo 48000 Hz/480000 frames; peak {peak:.6f} dBFS; DC/smooth endpoints/foreground+ambient duck/nonzero tail; independent editable source')
