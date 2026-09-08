#!/usr/bin/env python3
"""Original procedural intro SFX v4. Offline stdlib only; never plays or mixes voice.
MIT scope: this source and its generated sfx-v4.wav only; see assets/intro/README.md.
"""
import argparse
import array
import hashlib
import math
from pathlib import Path
import random
import sys
import tempfile
import wave

RATE = 48000
SEED = 505007
SFX_SECONDS = 10
TARGET_PEAK = 10 ** (-15 / 20)
ACCEPTED_SHA256 = 'fedff073eedfd00b039447dc885d71466538ec185618f7e6c0a65c6e0a5c83bc'
ASSET = Path(__file__).resolve().parents[1] / 'assets/intro/sfx-v4.wav'

def smooth(x):
    x = min(1., max(0., x))
    return x * x * (3 - 2 * x)


def envelope(t, duration, attack, release):
    return smooth(t / attack) * smooth((duration - t) / release)


def quantize(channels):
    data = array.array('h')
    for l, r in zip(*channels):
        for value in (l, r):
            assert abs(value) < 1, 'Do not silently limit/clip'
            data.append(round(value * 32767))
    return data


def write_pcm(path, pcm):
    assert all(-32768 < v < 32767 for v in pcm), 'Do not clip/limit silently'
    data = array.array('h', pcm)
    if sys.byteorder != 'little':
        data.byteswap()
    with wave.open(str(path), 'wb') as w:
        w.setparams((2, 2, RATE, len(data)//2, 'NONE', 'not compressed'))
        w.writeframes(data.tobytes())


def make_base():
    channels = [[0.] * (RATE * SFX_SECONDS) for _ in range(2)]
    rng = random.Random(SEED)
    cues = []

    def add(name, start, duration, gain, kind='tone', f0=800, f1=None,
            pan=0., attack=.009, release=.045):
        # Static is a random-phase multisine, not sampled game/reference audio.
        # Carriers stay 160–3000 Hz; smooth windows introduce small sidebands.
        partials = [(rng.uniform(160, 3000), rng.uniform(0, 2*math.pi))
                    for _ in range(48)] if kind == 'air' else []
        count = round(duration * RATE)
        win, signal = [], []
        for i in range(count):
            t = i / RATE
            e = envelope(t, (count-1)/RATE, attack, release)
            if kind == 'air':
                value = sum(math.sin(2*math.pi*f*t+p) for f,p in partials) / 12
            else:
                end = f0 if f1 is None else f1
                phase = 2*math.pi*(f0*t + .5*(end-f0)*t*t/duration)
                value = math.sin(phase) + .16*math.sin(2*phase)
            win.append(e)
            signal.append(e*value)
        # Remove event DC with the SAME smooth envelope, preserving zero edges.
        correction = sum(signal) / sum(win)
        offset = round(start * RATE)
        for i, (v, e) in enumerate(zip(signal, win)):
            v = (v - correction*e)*gain
            channels[0][offset+i] += v*(1 - .15*pan)
            channels[1][offset+i] += v*(1 + .15*pan)
        cues.append(dict(name=name, start=start, duration=duration, relative_gain=gain,
                         kind=kind, f0=f0 if kind=='tone' else None, f1=f1, pan=pan,
                         attack=attack, release=release))

    add('cold CRT static', .035, .32, .28, 'air', pan=-.3, attack=.025, release=.08)
    add('short tear', .51, .15, .32, 'air', pan=.3, release=.055)
    for t in (.76, 1.76, 2.56):
        add('sparse clock tick (artistic, not wall-clock sync)', t, .065, .22,
            f0=1120, release=.035)
    for i, t in enumerate((2.73, 2.91, 3.10, 3.29)):
        add('corrupt clock', t, .08, .27, f0=970-i*115, f1=420+i*80,
            pan=(-1)**i*.3, attack=.006, release=.027)
    for i in range(9):
        add('error blip', 3.4+i*.17, .105, .20+i*.022,
            f0=640+(i%3)*83, f1=590+(i%3)*83, attack=.012, release=.048)
    add('HDD rising load', 4.9, 1.72, .35, f0=210, f1=1260,
        attack=.13, release=.20)
    add('HDD air', 5.10, 1.52, .09, 'air', pan=.25, attack=.25, release=.22)
    add('reveal low bloom', 6.7, .48, .44, f0=105, f1=68,
        attack=.055, release=.19)
    add('reveal air', 6.7, .48, .14, 'air', pan=-.2, attack=.07, release=.19)
    add('soft move texture', 7.8, .9, .045, 'air', pan=.2, attack=.20, release=.4)
    # Duck before speech; never recover under speech, including the move texture.
    for i in range(len(channels[0])):
        duck = 1 - .94*smooth((i/RATE - 6.85)/.33)
        for c in channels:
            c[i] *= duck
    scale = TARGET_PEAK/max(abs(v) for c in channels for v in c)
    for c in channels:
        for i in range(len(c)):
            c[i] *= scale
    return channels, cues, scale



START, END = 2.7, 6.7
REVISION_SEED = 505008
TARGET = 10 ** (-16.5 / 20)

def make_revision():
    channels = [[0.0] * (RATE * 10) for _ in range(2)]
    events = []

    def grain(name, start, duration, gain, *, low=250, high=2400,
              hold=1, fracture=False, pan=0, attack=.005, release=.025):
        """No tonal carrier. Band-shaped noise; smooth grain and dropout edges."""
        rng = random.Random(REVISION_SEED + len(events) * 131)
        n = round(duration * RATE)
        offset = round(start * RATE)
        assert round(START * RATE) <= offset and offset + n <= round(END * RATE)
        lp_a = 1 - math.exp(-2 * math.pi * high / RATE)
        hp_a = 1 - math.exp(-2 * math.pi * low / RATE)
        gate_a = 1 - math.exp(-1 / (.0008 * RATE))
        lp1 = lp2 = low_state = output_filter = 0.0
        gate = 1.0
        target_gate = 1.0
        raw = 0.0
        values, windows = [], []
        # Uneven micro-packets, not a regular pitched tremolo or musical sequence.
        next_gate = round(rng.uniform(.009, .023) * RATE)
        for i in range(n):
            if i % hold == 0:
                raw = rng.uniform(-1, 1)
            lp1 += lp_a * (raw - lp1)
            lp2 += lp_a * (lp1 - lp2)
            low_state += hp_a * (lp2 - low_state)
            shaped = math.tanh(2.0 * (lp2 - low_state)) / math.tanh(2.0)
            # Roll off added saturation harmonics; no square wave/oscillator.
            output_filter += lp_a * (shaped - output_filter)
            if fracture and i >= next_gate:
                target_gate = rng.choice([0.0, .12, .45, 1.0])
                next_gate = i + round(rng.uniform(.006, .019) * RATE)
            gate += gate_a * (target_gate - gate)
            e = envelope(i / RATE, (n - 1) / RATE, attack, release) * gate
            windows.append(e)
            values.append(e * output_filter)
        # Window-weighted zero-mean correction retains silent event boundaries.
        correction = sum(values) / sum(windows)
        for i, (v, e) in enumerate(zip(values, windows)):
            v = (v - correction * e) * gain
            channels[0][offset + i] += v * (1 - .10 * pan)
            channels[1][offset + i] += v * (1 + .10 * pan)
        events.append(dict(name=name, start=start, duration=duration,
                           relative_gain=gain, noise_band_hz=[low, high],
                           sample_hold=hold, fracture=fracture, pan=pan,
                           attack=attack, release=release))

    # Clock destabilizes through sparse torn packets with low-level afterimages.
    for i, (t, d) in enumerate([(2.735, .145), (2.93, .16), (3.155, .195)]):
        grain('clock packet fracture', t, d, .65 + .08 * i,
              low=360, high=2050 + 130 * i, hold=3, fracture=True,
              pan=(-1) ** i * .35, release=.04)
        grain('clock packet afterimage', t + .028, d, .09,
              low=500, high=1500, hold=4, fracture=True,
              pan=-(-1) ** i * .35, attack=.012, release=.05)

    # ERROR windows retain their nine visual onsets, but have no note sequence.
    for i in range(9):
        t = 3.4 + i * .17
        grain('error data impact', t, .064 + (i % 3) * .009, .68 + i * .025,
              low=310, high=1700 + (i % 3) * 130, hold=2,
              pan=(-1) ** i * .18, attack=.0035, release=.031)
        grain('error frayed tail', t + .018, .10, .15,
              low=650, high=2500, hold=3, fracture=True,
              pan=-(-1) ** i * .18, attack=.014, release=.05)

    # HDD: subdued data bed and a gathering packet cadence, not a pitch sweep.
    grain('HDD diffuse data bed', 4.94, 1.67, .11,
          low=360, high=1850, hold=3, attack=.16, release=.22)
    for i in range(17):
        u = i / 16
        t = 4.975 + 1.42 * (1 - (1 - u) ** 1.35)
        grain('HDD transfer packet', t, .045, .28 + .14 * u,
              low=600, high=2250, hold=2, pan=.18 * (-1) ** i,
              attack=.003, release=.022)
    grain('HDD final lock texture', 6.52, .095, .29,
          low=450, high=2000, hold=3, fracture=True,
          attack=.008, release=.045)

    # Scale only the replacement region. Never renormalize unrelated v1 phases.
    scale = TARGET / max(abs(v) for c in channels for v in c)
    for c in channels:
        for i in range(round(START * RATE), round(END * RATE)):
            c[i] *= scale
    return channels, events, scale


# Accepted v3/v4 stages retain their PCM16 boundaries; do not float-mix them.
HDD_START, HDD_END = 4.9, 6.7
HDD_SEED = 505009
FRAMES = SFX_SECONDS * RATE
AMBIENT_SEED = 505010
TARGET_BED_RMS_DBFS = -42.5
DUCK_START, DUCK_END, DUCK_GAIN = 6.85, 7.2, .20
FADE_START, FADE_END = 8.8, (FRAMES-1)/RATE
EVENTS = [(1.28, .13), (3.93, .17), (5.83, .14)]


def rms(data):
    return math.sqrt(sum(v*v for v in data)/len(data))


def smooth_hdd(old):
    n = len(old)//2
    rng = random.Random(HDD_SEED)
    body1 = body2 = body_low = air1 = air2 = air_low = 0.
    samples, weights = [], []
    # Broad bands rather than resonant notes; slowly open the airy layer.
    body_a = 1-math.exp(-2*math.pi*780/RATE)
    low_a = 1-math.exp(-2*math.pi*180/RATE)
    air_low_a = 1-math.exp(-2*math.pi*650/RATE)
    for i in range(n):
        t = i/RATE
        p = smooth(i/(n-1))
        body1 += body_a*(rng.uniform(-1, 1)-body1)
        body2 += body_a*(body1-body2)
        body_low += low_a*(body2-body_low)
        air_a = 1-math.exp(-2*math.pi*(1550+650*p)/RATE)
        air1 += air_a*(rng.uniform(-1, 1)-air1)
        air2 += air_a*(air1-air2)
        air_low += air_low_a*(air2-air_low)
        # Long smooth attack/release; no packet gates, ticks, saturation or tremolo.
        e = smooth(t/.22)*smooth(((n-1)/RATE-t)/.32)*(.76+.24*p)
        v = .85*(body2-body_low)+.28*(air2-air_low)
        samples.append(e*v)
        weights.append(e)
    correction = sum(samples)/sum(weights)
    samples = [v-correction*e for v, e in zip(samples, weights)]
    # Match average energy slightly below v2, not peak-normalize a sustained bed
    # up to the old transient peak. This is NOT a perceptual loudness measurement.
    target_rms = rms(old)/32768*10**(-.7/20)
    stereo = []
    for i, v in enumerate(samples):
        pan = -.12+.24*smooth(i/(n-1))
        stereo.extend((v*(1-.10*pan), v*(1+.10*pan)))
    scale = target_rms/rms(stereo)
    if max(map(abs, stereo))*scale > 10**(-23/20):
        scale = 10**(-23/20)/max(map(abs, stereo))
    return array.array('h', (round(v*scale*32767) for v in stereo))



def band_noise(low, high, seed, frames=FRAMES):
    """Two-pole lowpass minus slow low band: soft colored noise, not ideal 1/f."""
    rng = random.Random(seed)
    lp1 = lp2 = lower = 0.
    a = 1-math.exp(-2*math.pi*high/RATE)
    b = 1-math.exp(-2*math.pi*low/RATE)
    values = []
    for _ in range(frames):
        lp1 += a*(rng.uniform(-1, 1)-lp1)
        lp2 += a*(lp1-lp2)
        lower += b*(lp2-lower)
        values.append(lp2-lower)
    scale = 1/rms(values)
    return [v*scale for v in values]


def gain(t):
    attack = smooth(t/.35)
    duck = 1-(1-DUCK_GAIN)*smooth((t-DUCK_START)/(DUCK_END-DUCK_START))
    fade = 1-smooth((t-FADE_START)/(FADE_END-FADE_START))
    return attack*duck*fade


def make_ambient():
    # Independent broad-band fans, not motors modeled as loud musical harmonics.
    floor = band_noise(45, 280, AMBIENT_SEED)
    racks = band_noise(120, 600, AMBIENT_SEED+1)
    air = band_noise(500, 1800, AMBIENT_SEED+2)
    activity = [0.]*FRAMES
    for index, (start, duration) in enumerate(EVENTS):
        n = round(duration*RATE)
        packet = band_noise(700, 1900, AMBIENT_SEED+100+index, n)
        for i, v in enumerate(packet):
            t = i/RATE
            e = smooth(t/.028)*smooth(((n-1)/RATE-t)/.065)
            activity[round(start*RATE)+i] += .10*e*v
    channels = [[], []]
    weights = []
    for i in range(FRAMES):
        t = i/RATE
        # Very slow shallow changes give a multi-machine background, not tremolo.
        drift = 1+.035*math.sin(2*math.pi*.17*t)
        common = .70*floor[i]*drift+.40*racks[i]+.14*air[i]+activity[i]
        side = .025*racks[i]-.015*air[i]
        e = gain(t)
        channels[0].append(e*(common+side))
        channels[1].append(e*(common-side))
        weights.append(e)
    # Keep silent edges while removing the low-frequency finite-window bias.
    for c in channels:
        bias = sum(c)/sum(weights)
        for i in range(FRAMES): c[i] -= bias*weights[i]
    a, b = round(.5*RATE), round(6.7*RATE)
    level = math.sqrt(sum(v*v for c in channels for v in c[a:b])/(2*(b-a)))
    scale = 10**(TARGET_BED_RMS_DBFS/20)/level
    pcm = array.array('h')
    for left, right in zip(*channels):
        for v in (left, right):
            assert abs(v*scale) < .1, 'Unexpected ambience peak'
            pcm.append(round(v*scale*32767))
    return pcm



def make_foreground():
    base, _, _ = make_base()
    revision, _, _ = make_revision()
    a, b = round(START * RATE), round(END * RATE)
    for c in range(2):
        base[c][a:b] = revision[c][a:b]
    # v3 measures RMS and replaces HDD on quantized v2, not its float precursor.
    pcm = quantize(base)
    a, b = round(HDD_START * RATE)*2, round(HDD_END * RATE)*2
    pcm[a:b] = smooth_hdd(pcm[a:b])
    return pcm


def generate(path):
    foreground = make_foreground()
    ambient = make_ambient()
    # v4 adds two independently quantized PCM streams, without renormalization.
    mixed = [v + bed for v, bed in zip(foreground, ambient)]
    write_pcm(path, mixed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='write editable synthesis to this WAV path')
    parser.add_argument('--check', action='store_true', help='regenerate temporarily; require accepted hash and packaged byte equality')
    args = parser.parse_args()
    if args.check:
        with tempfile.TemporaryDirectory(prefix='fairy-sfx-check-') as directory:
            path = Path(directory) / 'sfx-v4.wav'
            generate(path)
            data = path.read_bytes()
            assert hashlib.sha256(data).hexdigest() == ACCEPTED_SHA256
            assert data == ASSET.read_bytes()
        print('PASS exact regeneration and accepted SHA256: ' + ACCEPTED_SHA256)
    elif args.output:
        generate(args.output)
    else:
        parser.error('choose --check or --output; no implicit asset overwrites')


if __name__ == '__main__':
    main()
