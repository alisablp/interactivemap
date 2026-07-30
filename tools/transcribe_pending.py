#!/usr/bin/env python3
"""Download audio + transcribe the after-videos that have no YouTube
auto-captions (yt_titles/pending_video_meta identifies them). Writes
incrementally to transcripts2.json so progress survives interruption."""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
META_PATH = os.path.join(HERE, "pending_video_meta.json")
OUT_PATH = os.path.join(HERE, "transcripts2.json")
AUDIO_DIR = os.path.join(HERE, "audio_cache")
os.makedirs(AUDIO_DIR, exist_ok=True)

meta = json.load(open(META_PATH))
out = json.load(open(OUT_PATH)) if os.path.exists(OUT_PATH) else {}

import whisper
print("loading whisper model (small) ...", flush=True)
model = whisper.load_model("small")
print("model loaded", flush=True)

total = len(meta)
done = 0
for vid, m in meta.items():
    done += 1
    if vid in out:
        print(f"[{done}/{total}] {vid} already transcribed, skipping", flush=True)
        continue
    audio_path = os.path.join(AUDIO_DIR, vid + ".m4a")
    t0 = time.time()
    try:
        if not os.path.exists(audio_path):
            subprocess.run(
                ["yt-dlp", "--extractor-args", "youtube:player_client=android",
                 "-x", "--audio-format", "m4a", "--audio-quality", "5",
                 "-o", os.path.join(AUDIO_DIR, vid + ".%(ext)s"),
                 "--no-playlist", "--quiet", "--no-warnings",
                 "https://www.youtube.com/watch?v=" + vid],
                check=True, timeout=180
            )
        if not os.path.exists(audio_path):
            print(f"[{done}/{total}] {vid} download failed (no file)", flush=True)
            continue
        result = model.transcribe(audio_path, language="en", fp16=False)
        text = result["text"].strip()
        out[vid] = {"meta": m, "words": len(text.split()), "text": text[:6000]}
        json.dump(out, open(OUT_PATH, "w"), indent=0)
        dt = time.time() - t0
        print(f"[{done}/{total}] {vid} ok — {len(text.split())} words in {dt:.0f}s", flush=True)
    except Exception as e:
        print(f"[{done}/{total}] {vid} FAILED: {type(e).__name__} {str(e)[:150]}", flush=True)
    finally:
        # audio isn't needed once transcribed — keep disk usage down
        if os.path.exists(audio_path):
            os.remove(audio_path)

print(f"done. {len(out)}/{total} transcribed.", flush=True)
