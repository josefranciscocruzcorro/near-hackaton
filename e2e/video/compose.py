"""Builds the final videos (EN and ES) from the recorded frames, the narration and the subtitles.

The app is recorded at 1920x972; a 108 px band is added below it for subtitles, so captions never cover the UI.
Captions are split into chunks of at most two lines and timed with the narration of each scene.

Usage: python -I compose.py <workdir> <outdir>
"""
import json
import os
import re
import subprocess
import sys
import wave

W, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
scenes = {s["id"]: s for s in json.load(open(os.path.join(HERE, "scenes.json"), encoding="utf-8"))}
# Optional per-cut text overrides (e.g. the X cut adds a disclaimer to one scene).
if os.environ.get("SCENES_OVERRIDE"):
    for o in json.load(open(os.path.join(HERE, os.environ["SCENES_OVERRIDE"]), encoding="utf-8")):
        scenes[o["id"]] = o
tl = json.load(open(os.path.join(W, "timeline.json"), encoding="utf-8"))
# Cut silent waits (e.g. the AI thinking after the narration ended): drop those frames and shift time.
IDLES = sorted((i["from"], i["to"]) for i in tl.get("idles", []) if i["to"] > i["from"])


def shift(t: float) -> float:
    cut = 0.0
    for a, b in IDLES:
        if t >= b:
            cut += b - a
        elif t > a:
            cut += t - a
    return t - cut


tl["frames"] = [dict(f, t=shift(f["t"])) for f in tl["frames"] if not any(a < f["t"] < b for a, b in IDLES)]
tl["scenes"] = [dict(s, start=shift(s["start"]), end=shift(s["end"])) for s in tl["scenes"]]
END = shift(tl["end"])
print(f"cut {sum(b - a for a, b in IDLES):.1f}s of silent waiting; final length {END:.1f}s")
RATE = 48000
AUDIO_LEAD = 0.25  # seconds between a scene starting and its narration
LINE_CHARS = 96  # characters that fit on one subtitle line at 34 px over 1920 px
CHUNK_CHARS = 170  # two lines, with margin


def win_to_docker(p: str) -> str:
    out = subprocess.run(["cygpath", "-w", p], capture_output=True, text=True).stdout.strip()
    return out or p


def ffmpeg(args, mounts):
    vols = []
    for host, inner in mounts:
        vols += ["-v", f"{win_to_docker(host)}:{inner}"]
    cmd = ["docker", "run", "--rm", *vols, "jrottenberg/ffmpeg:7.1-ubuntu", "-hide_banner", "-loglevel", "error", "-y", *args]
    env = dict(os.environ, MSYS_NO_PATHCONV="1")
    subprocess.run(cmd, check=True, env=env)


# ---------- frames → concat list ----------
frames = [f for f in tl["frames"] if f["t"] >= 0]
lines = ["ffconcat version 1.0"]
for i, f in enumerate(frames):
    start = 0.0 if i == 0 else f["t"]
    nxt = frames[i + 1]["t"] if i + 1 < len(frames) else END
    dur = max(nxt - start, 0.001)
    lines.append(f"file 'frames/{f['file']}'")
    lines.append(f"duration {dur:.4f}")
lines.append(f"file 'frames/{frames[-1]['file']}'")
open(os.path.join(W, "frames.ffconcat"), "w", encoding="utf-8").write("\n".join(lines) + "\n")


# ---------- subtitles ----------
def ass_time(t: float) -> str:
    t = max(t, 0)
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def chunks(text: str):
    sentences = re.split(r"(?<=[.!?:;])\s+", text.strip())
    out, cur = [], ""
    for s in sentences:
        parts = [s] if len(s) <= CHUNK_CHARS else re.split(r"(?<=,)\s+", s)
        for p in parts:
            if len(p) > CHUNK_CHARS:  # last resort: split on words
                words, buf = p.split(), ""
                for w in words:
                    if len(buf) + len(w) + 1 > CHUNK_CHARS:
                        out.append(buf.strip()); buf = ""
                    buf += " " + w
                p = buf.strip()
            if cur and len(cur) + 1 + len(p) > CHUNK_CHARS:
                out.append(cur); cur = p
            else:
                cur = (cur + " " + p).strip()
    if cur:
        out.append(cur)
    return out


def two_lines(text: str) -> str:
    if len(text) <= LINE_CHARS:
        return text
    mid = len(text) // 2
    left, right = text.rfind(" ", 0, mid + 1), text.find(" ", mid)
    cut = left if right == -1 or (left != -1 and mid - left <= right - mid) else right
    return text[:cut] + r"\N" + text[cut + 1:]


def esc(t: str) -> str:
    return t.replace("{", "(").replace("}", ")")


def write_ass(lang: str, durations):
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Band,Segoe UI,34,&H00F5F5F4,&H00F5F5F4,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,60,60,14,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for s in tl["scenes"]:
        text = scenes[s["id"]][lang]
        start = s["start"] + AUDIO_LEAD
        total = durations[s["id"]]
        parts = chunks(text)
        weights = [len(p) for p in parts]
        t = start
        for p, wgt in zip(parts, weights):
            d = total * wgt / sum(weights)
            events.append(f"Dialogue: 0,{ass_time(t)},{ass_time(t + d + 0.15)},Band,,0,0,0,,{esc(two_lines(p))}")
            t += d
    path = os.path.join(W, f"subs_{lang}.ass")
    open(path, "w", encoding="utf-8").write(head + "\n".join(events) + "\n")
    # Guard: never more than two lines per caption.
    assert all(e.count(r"\N") <= 1 for e in events)
    return os.path.basename(path)


# ---------- audio ----------
def write_audio(lang: str):
    total = int((END + 1) * RATE)
    buf = bytearray(total * 2)
    durs = {}
    for s in tl["scenes"]:
        with wave.open(os.path.join(W, "audio", lang, f"{s['id']}.wav")) as x:
            assert x.getframerate() == RATE and x.getsampwidth() == 2 and x.getnchannels() == 1
            data = x.readframes(x.getnframes())
            durs[s["id"]] = x.getnframes() / RATE
        at = int((s["start"] + AUDIO_LEAD) * RATE) * 2
        end = min(at + len(data), len(buf))
        buf[at:end] = data[: end - at]
        nxt = next((n for n in tl["scenes"] if n["start"] > s["start"]), None)
        if nxt and s["start"] + AUDIO_LEAD + durs[s["id"]] > nxt["start"] + AUDIO_LEAD:
            print(f"  warning: {lang} narration of {s['id']} overlaps the next scene")
    path = os.path.join(W, f"narration_{lang}.wav")
    with wave.open(path, "w") as o:
        o.setnchannels(1); o.setsampwidth(2); o.setframerate(RATE); o.writeframes(bytes(buf))
    return os.path.basename(path), durs


fonts = "C:/Windows/Fonts"
for lang in ("en", "es"):
    audio, durs = write_audio(lang)
    subs = write_ass(lang, durs)
    out_name = f"tesorero-demo-{lang}.mp4"
    print(f"> encoding {out_name}", flush=True)
    ffmpeg([
        "-f", "concat", "-safe", "0", "-i", "/w/frames.ffconcat",
        "-i", f"/w/{audio}",
        "-vf", f"fps=30,scale=1920:972:flags=lanczos,pad=1920:1080:0:0:color=0x0b0b0c,subtitles=/w/{subs}:fontsdir=/fonts",
        "-c:v", "libx264", "-preset", os.environ.get("PRESET", "slow"), "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "160k", "-shortest",
        f"/out/{out_name}",
    ], [(W, "/w"), (OUT, "/out"), (fonts, "/fonts")])
print("done")
