#!/usr/bin/env python3
"""Generate City Run's sound effects with ElevenLabs' sound-generation API.

The key is read from the philipbaker.us project's .env.local INSIDE this process and used only as a
request header. It is never printed, logged, written to disk or passed on a command line.
Usage: gen_sfx.py [name ...]   (no names = everything that is not already on disk)
"""
import json, os, sys, urllib.request, urllib.error

ENV = "/Volumes/Home/02. Project Files/01. Software Development/001. PhilipBaker.us + Catapult + AechTech Sites/philipbaker.us/.env.local"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sfx")
URL = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128"

# name: (seconds, prompt_influence, loop, prompt)
SOUNDS = {
    "launch":   (1.4, .55, False, "Futuristic surface-to-air interceptor missile launch: a tight electromagnetic thump followed by a fast rising whoosh, clean modern sci-fi, dry, no voice, no music"),
    "blast":    (2.4, .5,  False, "Mid-air energy detonation in a sci-fi sky: deep punchy sub bass boom with a bright plasma crackle and a smooth airy decaying tail, cinematic, no voice, no music"),
    "impact":   (3.0, .5,  False, "Huge warhead explosion hitting a city building nearby: heavy low-end blast, concrete debris scattering, long rumbling echo between skyscrapers, cinematic, no music"),
    "collapse": (4.5, .5,  False, "A glass and steel skyscraper collapsing: deep structural groan, cascading shattering glass, massive rumbling avalanche of debris, long dusty decay, no music"),
    "pickup":   (0.9, .6,  False, "Holographic power-up collected: bright glassy digital chime with a quick rising sparkle, clean modern game interface sound"),
    "jam":      (1.2, .6,  False, "Communications link jammed: harsh digital glitch burst, bit-crushed static and a stuttering descending data tone, futuristic"),
    "restore":  (0.8, .6,  False, "Signal reconnected: soft clean ascending two-note digital confirmation beep, modern holographic interface"),
    "dry":      (0.5, .6,  False, "Short muted low denied buzz, futuristic interface error blip, single"),
    "warn":     (1.0, .6,  False, "Futuristic proximity warning: two quick urgent high-pitched electronic beeps, clean holographic cockpit alert"),
    "level":    (2.8, .5,  False, "Cinematic sci-fi riser: airy whoosh building into a soft deep impact hit with a shimmering tail, mission start stinger, no melody"),
    "saved":    (2.6, .5,  False, "Uplifting futuristic success stinger: warm synth chord swell with sparkling crystalline shimmer, mission accomplished, short"),
    "over":     (3.4, .5,  False, "Dark descending synth power-down: ominous low drone sinking in pitch with a final hollow pulse, game over, futuristic"),
    "ui":       (0.5, .65, False, "Tiny subtle holographic interface click, soft glassy tick, minimal, modern UI"),
    "bonus":    (1.5, .55, False, "Shimmering reward: ascending crystalline arpeggio of bright glassy tones, futuristic, short and clean"),
    "engine":   (6.0, .5,  True,  "Steady smooth futuristic hover engine: low turbine hum with soft airy hiss, constant tone, no pulses, no melody, seamless loop"),
    "flyby":    (2.4, .5,  False, "Enemy jet bomber flying past overhead fast: deep doppler roar whooshing by, menacing sci-fi aircraft, no music"),
    "planekill":(2.8, .5,  False, "Aircraft destroyed in mid-air: sharp explosion followed by metallic breakup and burning debris whistling down, cinematic, no music"),
}

def key():
    for line in open(ENV, encoding="utf-8"):
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("ELEVENLABS_API_KEY not found in the project's .env.local")

def call(k, body):
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST",
                                 headers={"xi-api-key": k, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def main():
    os.makedirs(OUT, exist_ok=True); k = key(); want = sys.argv[1:] or [n for n in SOUNDS if not os.path.exists(os.path.join(OUT, n + ".mp3"))]
    for name in want:
        secs, infl, loop, text = SOUNDS[name]
        body = {"text": text, "duration_seconds": secs, "prompt_influence": infl, "model_id": "eleven_text_to_sound_v2"}
        if loop: body["loop"] = True
        try:
            try: audio = call(k, body); how = "v2" + (" loop" if loop else "")
            except urllib.error.HTTPError as e:
                if e.code not in (400, 422): raise
                audio = call(k, {"text": text, "duration_seconds": secs, "prompt_influence": infl}); how = "v1 (v2 params refused)"
            open(os.path.join(OUT, name + ".mp3"), "wb").write(audio)
            print(f"ok   {name:10s} {secs:>4}s  {len(audio):>7} bytes  [{how}]", flush=True)
        except urllib.error.HTTPError as e:
            detail = e.read()[:200].decode("utf-8", "replace")
            print(f"FAIL {name:10s} HTTP {e.code}: {detail}", flush=True)
        except Exception as e:
            print(f"FAIL {name:10s} {type(e).__name__}: {str(e)[:160]}", flush=True)

if __name__ == "__main__":
    main()
