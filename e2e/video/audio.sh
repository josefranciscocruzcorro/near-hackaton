#!/usr/bin/env bash
# Generates narration (Windows voices), normalizes it to 48 kHz mono and writes durations.json.
# Usage: bash video/audio.sh <workdir>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$1"
WD="$(cd "$W" && (pwd -W 2>/dev/null || pwd))"
rm -rf "$W/raw" "$W/audio"
powershell -NoProfile -ExecutionPolicy Bypass -File "$HERE/tts.ps1" -Scenes "$HERE/scenes.json" -OutDir "$W/raw" >/dev/null
MSYS_NO_PATHCONV=1 docker run --rm -v "$WD:/w" --entrypoint sh jrottenberg/ffmpeg:7.1-ubuntu -c '
  for l in en es; do mkdir -p /w/audio/$l; for f in /w/raw/$l/*.wav; do
    ffmpeg -loglevel error -y -i "$f" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ar 48000 -ac 1 -c:a pcm_s16le "/w/audio/$l/$(basename "$f")"
  done; done'
python -I - "$W" <<'PY'
import wave, json, os, sys
w = sys.argv[1]; out = {}
for lang in ("en", "es"):
    for f in sorted(os.listdir(f"{w}/audio/{lang}")):
        with wave.open(f"{w}/audio/{lang}/{f}") as x:
            out.setdefault(f[:-4], {})[lang] = round(x.getnframes() / x.getframerate(), 2)
json.dump(out, open(f"{w}/durations.json", "w"), indent=1)
print({l: round(sum(v[l] for v in out.values()), 1) for l in ("en", "es")})
PY
