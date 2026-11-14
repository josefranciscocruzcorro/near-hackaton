"""Builds a short cut for X (max 2:20) from a full recording, reusing its frames and narration.

Each chosen scene keeps its narration; its footage is sped up when it is longer than the narration
(e.g. waiting for the chain), so the result stays under X's 140-second limit for standard accounts.

Usage: python -I x_cut.py <full_workdir> <x_workdir> [override_dir]
       SCENES_OVERRIDE=scenes_x.json python -I compose.py <x_workdir> <outdir>
override_dir/audio/<lang>/<id>.wav replaces a scene's narration (e.g. an added disclaimer).
"""
import json
import os
import shutil
import sys
import wave

SRC, DST = sys.argv[1], sys.argv[2]
OVERRIDE = sys.argv[3] if len(sys.argv) > 3 else None
# (scene id, footage window): "all" or ("last", seconds) to keep only the end of a long scene.
CUT = [
    ("s01-title", "all"),
    ("s12-warnings", "all"),
    ("s15-agent-results", "all"),
    ("s41-treasury-prepare", "all"),
    ("s42-treasury-create", "all"),
    ("s45-real-payment", ("last", 36)),
    ("s48-closing", "all"),
]
TAIL = 0.7  # seconds of footage after the longest narration
LIMIT = 139.0

tl = json.load(open(os.path.join(SRC, "timeline.json"), encoding="utf-8"))
scenes = {s["id"]: s for s in tl["scenes"]}
idles = [(i["from"], i["to"]) for i in tl.get("idles", [])]

shutil.rmtree(DST, ignore_errors=True)
os.makedirs(os.path.join(DST, "frames"))
for lang in ("en", "es"):
    os.makedirs(os.path.join(DST, "audio", lang))

out_frames, out_scenes, t = [], [], 0.0
for sid, window in CUT:
    s = scenes[sid]
    start, end = s["start"], s["end"]
    if window != "all":
        start = max(start, end - window[1])
    audio = {}
    for lang in ("en", "es"):
        o = os.path.join(OVERRIDE, "audio", lang, f"{sid}.wav") if OVERRIDE else None
        audio[lang] = o if o and os.path.exists(o) else os.path.join(SRC, "audio", lang, f"{sid}.wav")
    narration = {lang: (lambda w: w.getnframes() / w.getframerate())(wave.open(p)) for lang, p in audio.items()}
    target = max(narration.values()) + TAIL
    length = end - start
    speed = max(1.0, length / target)
    new_len = length / speed
    frames = [f for f in tl["frames"] if start <= f["t"] < end and not any(a < f["t"] < b for a, b in idles)]
    # Always start the scene on a frame: reuse the last frame before the window if needed.
    before = [f for f in tl["frames"] if f["t"] < start]
    if before and (not frames or frames[0]["t"] > start):
        frames.insert(0, dict(before[-1], t=start))
    for f in frames:
        name = f"{len(out_frames) + 1:06d}.jpg"
        shutil.copyfile(os.path.join(SRC, "frames", f["file"]), os.path.join(DST, "frames", name))
        out_frames.append({"file": name, "t": round(t + (f["t"] - start) / speed, 4)})
    out_scenes.append({"id": sid, "start": round(t, 4), "end": round(t + new_len, 4)})
    for lang in ("en", "es"):
        shutil.copyfile(audio[lang], os.path.join(DST, "audio", lang, f"{sid}.wav"))
    print(f"{sid:24s} footage {length:5.1f}s -> {new_len:5.1f}s (x{speed:.2f})")
    t += new_len

json.dump({"t0": 0, "end": t, "scenes": out_scenes, "idles": [], "frames": out_frames, "issues": []},
          open(os.path.join(DST, "timeline.json"), "w", encoding="utf-8"), indent=1)
print(f"total {t:.1f}s ({'OK' if t <= LIMIT else 'TOO LONG'} for X, limit {LIMIT:.0f}s)")
if t > LIMIT:
    sys.exit(1)
