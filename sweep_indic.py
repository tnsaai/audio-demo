"""V1 Indic across all 22 Indic DiarBench languages.

Reports two things per language:

  WER    — context only. These are ~200 s conversations with 6-8 speakers and a
           concatenated speaker-attributed reference, so the score charges the
           engine for overlap and turn boundaries it does not model. Comparable
           between languages, not against ARen.

  script — the signal. What fraction of non-Latin output landed in the
           language's native script. This is what separates "transcribed" from
           "transliterated into the wrong alphabet".
"""
import json
import sys
import time
import urllib.request

BASE = "http://localhost:3020"
CLIPS_PER_LANGUAGE = 3

LANGS = [
    "Assamese", "Bengali", "Bodo", "Dogri", "Gujarati", "Hindi", "Kannada",
    "Kashmiri", "Konkani", "Maithili", "Malayalam", "Manipuri", "Marathi",
    "Nepali", "Odia", "Punjabi", "Sanskrit", "Santali", "Sindhi", "Tamil",
    "Telugu", "Urdu",
]

NATIVE = {
    "Assamese": "Bengali", "Bengali": "Bengali", "Bodo": "Devanagari",
    "Dogri": "Devanagari", "Gujarati": "Gujarati", "Hindi": "Devanagari",
    "Kannada": "Kannada", "Kashmiri": "Arabic", "Konkani": "Devanagari",
    "Maithili": "Devanagari", "Malayalam": "Malayalam", "Manipuri": "Bengali",
    "Marathi": "Devanagari", "Nepali": "Devanagari", "Odia": "Odia",
    "Punjabi": "Gurmukhi", "Sanskrit": "Devanagari", "Santali": "Ol Chiki",
    "Sindhi": "Arabic", "Tamil": "Tamil", "Telugu": "Telugu", "Urdu": "Arabic",
}

RANGES = [
    ("Arabic", 0x0600, 0x06FF), ("Devanagari", 0x0900, 0x097F),
    ("Bengali", 0x0980, 0x09FF), ("Gurmukhi", 0x0A00, 0x0A7F),
    ("Gujarati", 0x0A80, 0x0AFF), ("Odia", 0x0B00, 0x0B7F),
    ("Tamil", 0x0B80, 0x0BFF), ("Telugu", 0x0C00, 0x0C7F),
    ("Kannada", 0x0C80, 0x0CFF), ("Malayalam", 0x0D00, 0x0D7F),
    ("Ol Chiki", 0x1C50, 0x1C7F), ("Latin", 0x0041, 0x007A),
]


def script_profile(text, native):
    counts = {}
    for ch in text:
        cp = ord(ch)
        for name, lo, hi in RANGES:
            if lo <= cp <= hi:
                counts[name] = counts.get(name, 0) + 1
                break
    non_latin = {k: v for k, v in counts.items() if k != "Latin"}
    total = sum(non_latin.values())
    return {
        "nativeShare": round(non_latin.get(native, 0) / total, 3) if total else 0.0,
        "scripts": {k: round(v / total, 3) for k, v in
                    sorted(non_latin.items(), key=lambda kv: -kv[1])[:3]} if total else {},
        "latinChars": counts.get("Latin", 0),
        "nonLatinChars": total,
    }


def login():
    req = urllib.request.Request(
        BASE + "/api/auth/login",
        data=json.dumps({"username": "demo", "password": sys.argv[1]}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return urllib.request.urlopen(req, timeout=30).headers.get("Set-Cookie", "").split(";")[0]


def run(cookie, language):
    req = urllib.request.Request(
        BASE + "/api/benchmark",
        data=json.dumps({
            "benchmark": "diarbench",
            "diarLanguage": language,
            "limit": CLIPS_PER_LANGUAGE,
            "engines": ["v1indic"],
            "concurrency": 2,
        }).encode(),
        headers={"Content-Type": "application/json", "Cookie": cookie},
    )
    rows, errors = [], []
    with urllib.request.urlopen(req, timeout=3600) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line:
                continue
            e = json.loads(line)
            if e["type"] == "row":
                rows.append({
                    "sample": e["sample"],
                    "wer": e["wer"],
                    "subs": e["substitutions"],
                    "dels": e["deletions"],
                    "ins": e["insertions"],
                    "refWords": e["referenceWords"],
                    "latencyMs": e["latencyMs"],
                    "corrected": e.get("correctedSegments"),
                    "empty": e["empty"],
                    "hallucinated": e["hallucinated"],
                    **script_profile(e["text"], NATIVE[language]),
                    "text": e["text"][:300],
                })
            elif e["type"] == "error":
                errors.append(e["message"][:120])
    return {"rows": rows, "errors": errors}


def main():
    cookie = login()
    results, started = {}, time.time()
    for i, lang in enumerate(LANGS, 1):
        t0 = time.time()
        try:
            results[lang] = run(cookie, lang)
        except Exception as exc:  # noqa: BLE001 - keep sweeping past a failure
            results[lang] = {"rows": [], "errors": [str(exc)[:160]]}
        r = results[lang]["rows"]
        wer = sum(x["wer"] * x["refWords"] for x in r) / max(1, sum(x["refWords"] for x in r))
        share = sum(x["nativeShare"] for x in r) / len(r) if r else 0.0
        print(
            f"[{i:2d}/22] {lang:11s} {len(r)} clips  WER {wer*100:5.1f}%  "
            f"native-script {share*100:5.1f}%  {time.time()-t0:5.1f}s  "
            f"(elapsed {(time.time()-started)/60:.1f}m)",
            flush=True,
        )
        with open("sweep_results.json", "w", encoding="utf-8") as fh:
            json.dump(results, fh, ensure_ascii=False, indent=1)
    print(f"DONE in {(time.time()-started)/60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
