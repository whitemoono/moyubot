# -*- coding: utf-8 -*-
"""
MoyuBot film v3 audio builder.

Produces, from story.json (single source of truth):
  public/voice/cXX.wav      Chinese narration, RMS-normalized (edge-tts XiaoxiaoNeural, SAPI fallback offline)
  public/audio/music.wav    original procedural score, 109 s, sections aligned to scenes
  public/audio/sfx/*.wav    small UI sound-effect library (all synthesized, no samples)
  output/audio/voice-manifest.json  measured narration durations for the edit
  output/MoyuBot.zh-CN.srt  subtitles
  output/audio-report.json  build report (voice mode, fit check, music sections)
"""
from __future__ import annotations
import asyncio, json, math, subprocess, sys, wave
from pathlib import Path
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

ROOT = Path(__file__).resolve().parent.parent
STORY = json.loads((ROOT / "story.json").read_text(encoding="utf-8"))
OUT = ROOT / "output" / "audio"
PUB = ROOT / "public"
VOICE = PUB / "voice"
SFXD = PUB / "audio" / "sfx"
for p in (OUT, VOICE, SFXD):
    p.mkdir(parents=True, exist_ok=True)

SR = 44100
DURATION = STORY["scenes"][-1]["end"]
N = int(DURATION * SR)

# ---------------------------------------------------------------- dsp utils
def sec(n: float) -> int:
    return int(round(n * SR))

def t_axis(dur: float) -> np.ndarray:
    return np.arange(sec(dur)) / SR

def env_ar(n: int, attack: float, release: float, shape: float = 1.0) -> np.ndarray:
    a, r = max(1, sec(attack)), max(1, sec(release))
    e = np.ones(n, np.float64)
    na = min(a, n); nr = min(r, n)
    e[:na] = np.linspace(0, 1, na) ** shape
    if nr < n:
        e[-nr:] *= np.linspace(1, 0, nr) ** shape
    return e

def expdec(n: int, tau: float) -> np.ndarray:
    return np.exp(-np.arange(n) / (tau * SR))

def lp(x: np.ndarray, cut: float, order: int = 2) -> np.ndarray:
    sos = butter(order, min(cut, SR / 2 - 100), "low", fs=SR, output="sos")
    return sosfilt(sos, x)

def hp(x: np.ndarray, cut: float, order: int = 2) -> np.ndarray:
    sos = butter(order, max(cut, 20), "high", fs=SR, output="sos")
    return sosfilt(sos, x)

def bp(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    sos = butter(2, [max(lo, 20), min(hi, SR / 2 - 100)], "band", fs=SR, output="sos")
    return sosfilt(sos, x)

def pan2(sig: np.ndarray, pan: float = 0.0, haas: float = 0.0) -> np.ndarray:
    """mono -> stereo with constant-power pan and optional haas widening."""
    l = sig * math.sqrt((1 - pan) / 2)
    r = sig * math.sqrt((1 + pan) / 2)
    if haas > 0:
        d = sec(haas)
        r = np.concatenate([np.zeros(d), r])[: len(r)] * 0.9
    return np.stack([l, r], axis=1)

def reverb(sig: np.ndarray, wet: float = 0.16, seconds: float = 1.1, tone: float = 5200) -> np.ndarray:
    n = len(sig)
    rng = np.random.default_rng(2026)
    ir = rng.normal(0, 1, sec(seconds))
    ir *= np.exp(-np.arange(len(ir)) / (0.32 * SR))
    ir = lp(ir, tone)
    ir /= np.max(np.abs(ir)) + 1e-9
    wetL = fftconvolve(sig[:, 0], ir)[:n]
    ir2 = rng.normal(0, 1, sec(seconds))
    ir2 *= np.exp(-np.arange(len(ir2)) / (0.30 * SR))
    ir2 = lp(ir2, tone)
    ir2 /= np.max(np.abs(ir2)) + 1e-9
    wetR = fftconvolve(sig[:, 1], ir2)[:n]
    return sig * (1 - wet) + np.stack([wetL, wetR], axis=1) * wet

# ---------------------------------------------------------------- instruments
def i_pad(freq: float, dur: float) -> np.ndarray:
    tt = t_axis(dur)
    d = 0.4
    w = (np.sin(2 * np.pi * freq * tt) + np.sin(2 * np.pi * freq * (1 + d / 100) * tt)
         + 0.55 * np.sin(2 * np.pi * freq / 2 * tt) + 0.35 * np.sin(2 * np.pi * freq * 2 * tt))
    w = lp(w, 1400)
    return w * env_ar(len(tt), 0.9, min(1.4, dur / 2), 1.6)

def i_pluck(freq: float, dur: float = 0.42) -> np.ndarray:
    tt = t_axis(dur)
    w = (np.sin(2 * np.pi * freq * tt) + 0.42 * np.sin(2 * np.pi * freq * 2 * tt)
         + 0.18 * np.sin(2 * np.pi * freq * 3 * tt))
    w *= expdec(len(tt), 0.16)
    w = lp(w, 4800)
    return w * env_ar(len(tt), 0.002, 0.05)

def i_box(freq: float, dur: float = 1.35) -> np.ndarray:
    tt = t_axis(dur)
    w = (np.sin(2 * np.pi * freq * tt) + 0.34 * np.sin(2 * np.pi * freq * 3.03 * tt)
         + 0.16 * np.sin(2 * np.pi * freq * 5.41 * tt))
    w *= expdec(len(tt), 0.5)
    return w * env_ar(len(tt), 0.001, 0.08)

def i_bass(freq: float, dur: float = 0.5) -> np.ndarray:
    tt = t_axis(dur)
    w = np.sin(2 * np.pi * freq * tt) + 0.30 * np.sin(2 * np.pi * freq * 2 * tt) + 0.12 * np.tanh(3 * np.sin(2 * np.pi * freq * tt))
    w *= expdec(len(tt), 0.30) * env_ar(len(tt), 0.004, 0.08)
    return w

def i_kick(dur: float = 0.30) -> np.ndarray:
    tt = t_axis(dur)
    f = 42 + 110 * np.exp(-tt * 34)
    ph = 2 * np.pi * np.cumsum(f) / SR
    w = np.sin(ph) * np.exp(-tt * 16)
    w += 0.25 * hp(np.random.default_rng(1).normal(0, 1, len(tt)), 2200) * np.exp(-tt * 220)
    return w

def i_hat(dur: float = 0.055, open_: bool = False) -> np.ndarray:
    n = sec(dur + (0.14 if open_ else 0))
    noise = np.random.default_rng(7).normal(0, 1, n)
    w = hp(noise, 7200) * expdec(n, 0.012 if not open_ else 0.05)
    return w

def i_clap(dur: float = 0.24) -> np.ndarray:
    n = sec(dur)
    rng = np.random.default_rng(11)
    w = np.zeros(n)
    for k, at in enumerate((0, 0.012, 0.026)):
        s = sec(at)
        burst = bp(rng.normal(0, 1, n - s), 1100, 3000) * np.exp(-np.arange(n - s) / (0.05 * SR))
        w[s:] += burst * (1.0 if k < 2 else 0.7)
    return w

def i_shaker(dur: float = 0.09) -> np.ndarray:
    n = sec(dur)
    w = bp(np.random.default_rng(13).normal(0, 1, n), 3600, 8200)
    return w * env_ar(n, 0.004, 0.05)

def i_blip(freq: float, dur: float = 0.05) -> np.ndarray:
    tt = t_axis(dur)
    w = np.sign(np.sin(2 * np.pi * freq * tt)) * 0.5 + np.sin(2 * np.pi * freq * tt) * 0.5
    return lp(w, 5200) * env_ar(len(tt), 0.002, 0.02)

def i_riser(dur: float) -> np.ndarray:
    tt = t_axis(dur)
    f = 220 * 2 ** (tt / dur * 2.6)
    w = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.7 * bp(np.random.default_rng(17).normal(0, 1, len(tt)), 500, 5000)
    return w * env_ar(len(tt), dur * 0.75, 0.08, 2.0)

NOTE = {n: 440.0 * 2 ** ((i - 69) / 12) for i, n in enumerate(
    ["C0","C#0","D0","D#0","E0","F0","F#0","G0","G#0","A0","A#0","B0"] + 
    ["C1","C#1","D1","D#1","E1","F1","F#1","G1","G#1","A1","A#1","B1"] +
    ["C2","C#2","D2","D#2","E2","F2","F#2","G2","G#2","A2","A#2","B2"] +
    ["C3","C#3","D3","D#3","E3","F3","F#3","G3","G#3","A3","A#3","B3"] +
    ["C4","C#4","D4","D#4","E4","F4","F#4","G4","G#4","A4","A#4","B4"] +
    ["C5","C#5","D5","D#5","E5","F5","F#5","G5","G#5","A5","A#5","B5"] +
    ["C6","C#6","D6","D#6","E6","F6","F#6","G6","G#6","A6","A#6","B6"] +
    ["C7","C#7","D7","D#7","E7","F7","F#7","G7","G#7","A7","A#7","B7"])}

def nfreq(name: str) -> float:
    return NOTE[name]

CHORDS = {
    "Am": ["A2", "C4", "E4"], "F": ["F2", "A3", "C4"], "C": ["C3", "E4", "G4"], "G": ["G2", "B3", "D4"],
    "Em": ["E2", "G3", "B3"], "Dm": ["D3", "F4", "A4"],
}

# ---------------------------------------------------------------- score
def build_music() -> np.ndarray:
    bpm = STORY["music"]["bpm"]
    beat = 60 / bpm
    bar = beat * 4
    music = np.zeros((N, 2), np.float64)

    def put(at: float, sig: np.ndarray, gain: float = 1.0, pan: float = 0.0, dry_rev: bool = False):
        s = sec(at)
        n = min(len(sig), N - s)
        if n <= 0:
            return
        seg = sig[:n] * gain
        if seg.ndim == 1:
            seg = pan2(seg, pan)
        music[s:s + n] += seg

    secs = {x["name"]: x for x in STORY["music"]["sections"]}

    # --- harmonic plans (one chord per bar) ---
    plan = {
        "intro":    ["Am", "F", "C", "G", "Am", "F", "C"],
        "grooveA":  ["Am", "F", "C", "G"] * 3,
        "grooveB":  ["F", "G", "Am", "Em", "F", "G"],
        "musicbox": ["C", "G", "Am", "F", "C", "G", "Am", "G", "C"],
        "build":    ["F", "G", "Am", "G", "G"],
        "grooveA2": ["F", "C", "G", "Am", "F"],
        "outro":    ["Am", "F", "C", "G"],
    }

    # pad under everything except musicbox half and outro fade handled globally
    for name, chords in plan.items():
        s0 = secs[name]["start"]
        for i, ch in enumerate(chords):
            at = s0 + i * bar
            if at >= DURATION - 0.2:
                break
            root, third, fifth = CHORDS[ch]
            g = 0.16 if name in ("intro", "outro") else (0.11 if name == "musicbox" else 0.085)
            put(at, i_pad(nfreq(root) * 2, min(bar * 1.05, DURATION - at)), g, -0.18)
            put(at + 0.02, i_pad(nfreq(third), min(bar * 1.05, DURATION - at)), g * 0.8, 0.22)
            if name in ("intro", "outro", "musicbox"):
                put(at + 0.04, i_pad(nfreq(fifth), min(bar * 1.05, DURATION - at)), g * 0.6, 0.0)

    # music-box motif (the film's identity): E5 G5 A5 G5 | E5 D5 C5 hold
    motif = [("E5", 0.0, 1.0), ("G5", 0.75, 0.9), ("A5", 1.5, 1.0), ("G5", 2.25, 0.9),
             ("E5", 3.0, 1.0), ("D5", 3.75, 0.9), ("C5", 4.5, 1.6)]
    for name in ("intro", "outro"):
        s0 = secs[name]["start"]
        at0 = s0 + (0.4 if name == "intro" else 1.2)
        for note, at, g in motif:
            if at0 + at < DURATION - 0.3:
                put(at0 + at, i_box(nfreq(note), 1.4), 0.20 * g, 0.12)
                put(at0 + at + 0.30, i_box(nfreq(note), 1.2), 0.05 * g, -0.3)

    # sparkle seeds in intro
    for k, note in enumerate(("C6", "E6", "G6", "C7")):
        put(secs["intro"]["start"] + 1.0 + k * 0.42, i_box(nfreq(note), 0.9), 0.09, -0.4 + k * 0.22)

    # grooveA / grooveA2: light drums + pluck arps
    def groove(name: str, energy: float):
        s0 = secs[name]["start"]
        chords = plan[name]
        nbars = len(chords)
        for i in range(nbars):
            at = s0 + i * bar
            if at >= DURATION - 0.3:
                break
            ch = chords[i]
            # drums
            put(at, i_kick(), 0.62 * energy)
            put(at + 2 * beat, i_kick(), 0.5 * energy)
            for e in range(8):
                put(at + e * beat / 2, i_hat(open_=(e % 4 == 3)), (0.16 if e % 2 else 0.10) * energy, 0.12)
            if energy > 0.8 and i % 2 == 1:
                put(at + beat, i_clap(), 0.24 * energy)
            # arp (16ths, alternating pan)
            root, third, fifth = CHORDS[ch]
            notes = [root, third, fifth, third]
            for e in range(16):
                nname = notes[e % 4] if e % 8 not in (7, 15) else ("E5" if ch in ("C", "Am") else "D5")
                oct_up = "" if e % 8 < 4 else "+"
                f = nfreq(nname) * (2 if e % 8 >= 4 else 1)
                put(at + e * beat / 4, i_pluck(f), 0.15 * energy, -0.35 + 0.7 * ((e // 2) % 2))
            # bass
            put(at, i_bass(nfreq(root)), 0.4 * energy)
            put(at + 2.5 * beat, i_bass(nfreq(root)), 0.3 * energy)
    groove("grooveA", 0.75)
    groove("grooveA2", 0.85)

    # grooveB: denser bass + blips
    s0 = secs["grooveB"]["start"]
    for i, ch in enumerate(plan["grooveB"]):
        at = s0 + i * bar
        root, third, fifth = CHORDS[ch]
        for e in range(8):
            put(at + e * beat / 2, i_bass(nfreq(root) * (2 if e in (3, 7) else 1)), 0.42)
        put(at, i_kick(), 0.7)
        put(at + 2 * beat, i_kick(), 0.62)
        for e in range(8):
            put(at + e * beat / 2, i_hat(open_=(e % 4 == 3)), 0.17 if e % 2 else 0.11, 0.1)
        put(at + beat, i_clap(), 0.26)
        for e in (1, 5):
            put(at + e * beat / 2, i_blip(1600 if e == 1 else 2100), 0.10, 0.4)
        put(at, i_pad(nfreq(third), bar), 0.05, 0.1)

    # musicbox section: melody + half-time kick + shaker
    s0 = secs["musicbox"]["start"]
    mel = [
        ["E5", "G5", "C6", "G5", "E5", "G5", "A5", "G5"],
        ["D5", "G5", "B5", "G5", "D5", "G5", "A5", "B5"],
        ["A4", "C5", "E5", "C5", "A4", "C5", "D5", "E5"],
        ["F4", "A4", "C5", "A4", "F4", "A4", "C5", "D5"],
        ["E5", "G5", "C6", "G5", "E5", "G5", "A5", "G5"],
        ["D5", "G5", "B5", "G5", "D5", "G5", "A5", "B5"],
        ["C5", "E5", "A5", "E5", "C5", "E5", "G5", "A5"],
        ["B4", "D5", "G5", "D5", "B4", "D5", "F5", "G5"],
        ["C5", "E5", "G5", "C6", "G5", "E5", "C5", "G4"],
    ]
    for i, chname in enumerate(plan["musicbox"]):
        at = s0 + i * bar
        if at >= DURATION - 0.4:
            break
        put(at, i_kick(), 0.4)
        put(at + 2 * beat, i_kick(), 0.3)
        for e in range(4):
            put(at + e * beat + beat / 2, i_shaker(), 0.10, 0.15)
        for e, note in enumerate(mel[i]):
            g = 0.23 if e in (0, 4) else 0.17
            put(at + e * beat / 2, i_box(nfreq(note), 1.1), g, 0.1 + 0.1 * (e % 3))
    # build: add clap 2/4, riser at end, kick 4-floor ramp
    s0 = secs["build"]["start"]
    for i, ch in enumerate(plan["build"]):
        at = s0 + i * bar
        if at >= DURATION - 0.4:
            break
        floor = 0.5 + 0.12 * i
        for b in range(4):
            put(at + b * beat, i_kick(), floor)
        put(at + beat, i_clap(), 0.24 + 0.05 * i)
        put(at + 3 * beat, i_clap(), 0.2 + 0.05 * i)
        for e in range(8):
            put(at + e * beat / 2, i_hat(open_=(e == 7)), 0.16, 0.1)
        root = CHORDS[ch][0]
        put(at, i_bass(nfreq(root)), 0.4)
        put(at + 2 * beat, i_bass(nfreq(root)), 0.36)
    put(secs["build"]["end"] - bar - 0.05, i_riser(bar), 0.20)

    # bus: gentle glue
    music[:, 0] = np.tanh(music[:, 0] * 1.25)
    music[:, 1] = np.tanh(music[:, 1] * 1.25)
    music = reverb(music, 0.14, 1.25, 4800)
    peak = np.max(np.abs(music)) + 1e-9
    music *= 0.80 / peak
    # global fades
    fade_in = env_ar(N, 0.35, 0.001)
    fade_out_len = 2.2
    fo = np.ones(N)
    fo[-sec(fade_out_len):] = np.linspace(1, 0, sec(fade_out_len)) ** 1.4
    music *= fade_in[:, None] * fo[:, None]
    return music

# ---------------------------------------------------------------- sfx
def sfx_library() -> dict[str, np.ndarray]:
    lib: dict[str, np.ndarray] = {}

    def add(name: str, mono: np.ndarray, tail_stereo: bool = True):
        m = mono / (np.max(np.abs(mono)) + 1e-9)
        lib[name] = np.clip(pan2(m), -1, 1)

    tt = t_axis(0.5)
    noise = np.random.default_rng(23).normal(0, 1, len(tt))
    a = bp(noise, 300, 900); b = bp(noise, 900, 3600)
    mixw = a * np.linspace(1, 0.15, len(tt)) + b * np.linspace(0.1, 1, len(tt))
    add("whoosh", mixw * env_ar(len(tt), 0.10, 0.22, 1.8))

    tt = t_axis(0.12)
    f = 320 + 380 * (tt / tt[-1]) ** 1.4
    add("pop", np.sin(2 * np.pi * np.cumsum(f) / SR) * env_ar(len(tt), 0.003, 0.05))
    add("boop", (lambda x: np.sin(2 * np.pi * np.cumsum(265 - 55 * x / x[-1]) / SR) * env_ar(len(x), 0.008, 0.06))(t_axis(0.15)))

    def bell(freq: float, dur: float = 0.45, bright: float = 0.3) -> np.ndarray:
        x = t_axis(dur)
        w = np.sin(2 * np.pi * freq * x) + bright * np.sin(2 * np.pi * freq * 2.76 * x)
        return w * expdec(len(x), 0.14) * env_ar(len(x), 0.001, 0.03)

    def place(base: np.ndarray, at: float, sig: np.ndarray) -> np.ndarray:
        s = sec(at)
        end = min(len(base), s + len(sig))
        base[s:end] += sig[: end - s]
        return base

    add("ping", bell(740, 0.5))
    add("ping2", bell(988, 0.5))
    ch = place(place(np.zeros(sec(1.0)), 0.0, bell(1047, 0.6, 0.2)), 0.11, bell(1319, 0.7, 0.2))
    add("chime", ch)
    sp = np.zeros(sec(1.3))
    for i, f in enumerate((1319, 1568, 2093, 2637, 3136)):
        place(sp, i * 0.07, bell(f, 0.8, 0.25))
    add("sparkle", sp)

    add("click", hp(np.random.default_rng(29).normal(0, 1, sec(0.02)), 2600) * env_ar(sec(0.02), 0.001, 0.012))
    ticks = np.zeros(sec(0.20))
    for k in range(3):
        s = sec(k * 0.052)
        ticks[s:s + sec(0.02)] += hp(np.random.default_rng(31 + k).normal(0, 1, sec(0.02)), 2000) * env_ar(sec(0.02), 0.001, 0.014) * (1 - 0.2 * k)
    add("key", ticks)

    add("notify", np.concatenate([bell(660, 0.18, 0.1), np.zeros(sec(0.10)), bell(880, 0.35, 0.1)]))
    tt = t_axis(0.13)
    f = 520 - 190 * (tt / tt[-1])
    wob = 1 + 0.04 * np.sin(2 * np.pi * 28 * tt)
    add("bubble", np.sin(2 * np.pi * np.cumsum(f * wob) / SR) * env_ar(len(tt), 0.004, 0.05))
    add("page", bp(np.random.default_rng(37).normal(0, 1, sec(0.22)), 700, 2400) * env_ar(sec(0.22), 0.03, 0.12))

    tt = t_axis(0.95)
    f = 130 + 590 * (tt / tt[-1]) ** 0.8
    rising = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_ar(len(tt), 0.30, 0.20)
    hum = np.sin(2 * np.pi * 218 * tt) * np.linspace(0, 0.5, len(tt)) ** 2 * np.exp(-tt * 3)
    add("power_up", rising * 0.8 + hum)
    tt = t_axis(0.8)
    f = 620 - 470 * (tt / tt[-1]) ** 1.1
    add("power_down", np.sin(2 * np.pi * np.cumsum(f) / SR) * env_ar(len(tt), 0.01, 0.45) * 0.8
        + bp(np.random.default_rng(41).normal(0, 1, len(tt)), 100, 500) * np.exp(-tt * 5) * 0.3)
    return lib

def write_wav(path: Path, data: np.ndarray):
    x = np.clip(data, -1, 1)
    pcm = (x * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2 if pcm.ndim == 2 else 1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())

def read_wav(path: Path) -> tuple[int, np.ndarray]:
    with wave.open(str(path), "rb") as w:
        sr = w.getframerate()
        n = w.getnframes()
        ch = w.getnchannels()
        raw = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float64) / 32768
    return sr, raw.reshape(-1, ch) if ch > 1 else raw.reshape(-1, 1)

def ffmpeg() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

# ---------------------------------------------------------------- narration
def sapi_voice(text: str, path: Path) -> None:
    ps = f'''
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice("Microsoft Huihui Desktop")
$s.Rate = 2
$s.SetOutputToWaveFile("{path.as_posix()}")
$s.Speak("{text.replace('"', '')}")
$s.Dispose()
'''
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, capture_output=True)

async def synth_narration() -> tuple[list[dict], str]:
    import edge_tts
    mode = "edge-tts zh-CN-XiaoxiaoNeural"
    manifest = []
    for cue in STORY["cues"]:
        out_wav = VOICE / f"{cue['id']}.wav"
        tmp_mp3 = OUT / f"{cue['id']}.mp3"
        try:
            com = edge_tts.Communicate(cue["text"], "zh-CN-XiaoxiaoNeural", rate="+4%")
            await com.save(str(tmp_mp3))
            subprocess.run([ffmpeg(), "-y", "-v", "error", "-i", str(tmp_mp3),
                            "-ar", str(SR), "-ac", "1", str(OUT / f"{cue['id']}-raw.wav")], check=True)
        except Exception as e:
            print(f"  neural voice unavailable ({type(e).__name__}), falling back to SAPI for {cue['id']}", flush=True)
            mode = "SAPI Huihui (offline fallback)"
            sapi_voice(cue["text"], OUT / f"{cue['id']}-raw.wav")
        sr, x = read_wav(OUT / f"{cue['id']}-raw.wav")
        x = x[:, 0] if x.ndim > 1 else x
        # trim leading/trailing silence
        mag = np.abs(x)
        th = 0.004
        idx = np.where(mag > th)[0]
        if len(idx):
            x = x[max(0, idx[0] - sec(0.04)): min(len(x), idx[-1] + sec(0.12))]
        # RMS normalize, peak-safe
        rms = math.sqrt(np.mean(x ** 2)) + 1e-9
        gain = min(0.126 / rms, 0.89 / (np.max(np.abs(x)) + 1e-9))
        x = np.clip(x * gain, -1, 1)
        write_wav(out_wav, x[:, None])
        dur = len(x) / SR
        manifest.append({"id": cue["id"], "start": cue["start"], "dur": round(dur, 3),
                         "file": f"voice/{cue['id']}.wav", "text": cue["text"]})
        print(f"  {cue['id']}  {dur:5.2f}s  {cue['text']}")
    return manifest, mode

# ---------------------------------------------------------------- checks + outputs
def check_fit(manifest: list[dict]) -> list[str]:
    problems = []
    cues = {m["id"]: m for m in manifest}
    ordered = sorted(manifest, key=lambda m: m["start"])
    for i, m in enumerate(ordered):
        end = m["start"] + m["dur"]
        nxt = ordered[i + 1]["start"] if i + 1 < len(ordered) else DURATION
        if end > nxt - 0.25:
            problems.append(f"{m['id']} ends {end:.2f} but next cue/END at {nxt:.2f}")
    return problems

def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, rem = divmod(ms, 3600000); m, rem = divmod(rem, 60000); s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def main() -> None:
    print("== music ==", flush=True)
    music = build_music()
    write_wav(PUB / "audio" / "music.wav", music)
    print(f"  music.wav  {len(music)/SR:.2f}s", flush=True)

    print("== sfx ==", flush=True)
    lib = sfx_library()
    report_sfx = {}
    for name, data in lib.items():
        write_wav(SFXD / f"{name}.wav", data)
        report_sfx[name] = round(len(data) / SR, 3)
    print(f"  {len(lib)} effects: {', '.join(lib)}", flush=True)

    print("== narration ==", flush=True)
    manifest, mode = asyncio.run(synth_narration())
    problems = check_fit(manifest)
    for p in problems:
        print("  FIT WARNING:", p, flush=True)

    srt = "\n\n".join(
        f"{i+1}\n{srt_time(m['start'])} --> {srt_time(min(m['start'] + m['dur'], DURATION))}\n{m['text']}"
        for i, m in enumerate(sorted(manifest, key=lambda x: x["start"]))) + "\n"
    (ROOT / "output" / "MoyuBot.zh-CN.srt").write_text(srt, encoding="utf-8-sig")

    (OUT / "voice-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "audio-report.json").write_text(json.dumps({
        "voice_mode": mode, "sample_rate": SR, "duration": DURATION,
        "music": {"bpm": STORY["music"]["bpm"], "sections": STORY["music"]["sections"]},
        "sfx": report_sfx, "fit_problems": problems,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"done. voice={mode}, fit_problems={len(problems)}", flush=True)

if __name__ == "__main__":
    main()
