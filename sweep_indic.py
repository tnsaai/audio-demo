"""One DiarBench recording per Indic language, all three engines.

Answers a narrower question than WER can on its own: for each language, which
script does each engine actually emit? On a 200 s multi-speaker recording the
WER is dominated by deletions and speaker overlap, so the script column is the
signal and the WER column is context.
"""
import json
import re
import sys
import time
import urllib.request

BASE = "http://localhost:3020"
LANGS = [
    "Assamese", "Bengali", "Bodo", "Dogri", "Gujarati", "Hindi", "Kannada",
    "Kashmiri", "Konkani", "Maithili", "Malayalam", "Manipuri", "Marathi",
    "Nepali", "Odia", "Punjabi", "Sanskrit", "Santali", "Sindhi", "Tamil",
    "Telugu", "Urdu",
]

# Native script each language is normally written in, for the "correct?" check.
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
    """Share of non-Latin characters written in the language's native script.

    A single "dominant script" label hides mixed output — an engine can emit
    Bengali, Latin and Gurmukhi in one transcript. What matters is how much of
    the non-Latin text landed in the right script.
    """
    counts = {}
    for ch in text:
        cp = ord(ch)
        for name, lo, hi in RANGES:
            if lo <= cp <= hi:
                counts[name] = counts.get(name, 0) + 1
                break
    non_latin = {k: v for k, v in counts.items() if k != "Latin"}
    total = sum(non_latin.values())
    native_share = (non_latin.get(native, 0) / total) if total else 0.0
    top = sorted(non_latin.items(), key=lambda kv: -kv[1])[:3]
    return {
        "nativeShare": round(native_share, 3),
        "scripts": {k: round(v / total, 3) for k, v in top} if total else {},
        "latinChars": counts.get("Latin", 0),
        "nonLatinChars": total,
    }


def login():
    req = urllib.request.Request(
        BASE + "/api/auth/login",
        data=json.dumps({"username": "demo", "password": sys.argv[1]}).encode(),
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=30)
    return resp.headers.get("Set-Cookie", "").split(";")[0]


def run(cookie, language):  # noqa: C901
    req = urllib.request.Request(
        BASE + "/api/benchmark",
        data=json.dumps(
            {"benchmark": "diarbench", "diarLanguage": language, "limit": 1}
        ).encode(),
        headers={"Content-Type": "application/json", "Cookie": cookie},
    )
    out = {}
    with urllib.request.urlopen(req, timeout=1800) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line:
                continue
            e = json.loads(line)
            if e["type"] == "row":
                out[e["engine"]] = {
                    "wer": e["wer"],
                    **script_profile(e["text"], NATIVE[language]),
                    "text": e["text"][:400],
                    "subs": e["substitutions"],
                    "deletions": e["deletions"],
                    "insertions": e["insertions"],
                    "refWords": e["referenceWords"],
                    "correctionMs": e.get("correctionMs"),
                    "correctedSegments": e.get("correctedSegments"),
                    "correctionError": e.get("correctionError"),
                }
            elif e["type"] == "error":
                out[e["engine"]] = {"error": e["message"][:120]}
    return out


def main():
    cookie = login()
    results = {}
    started = time.time()
    for i, lang in enumerate(LANGS, 1):
        t0 = time.time()
        try:
            results[lang] = run(cookie, lang)
        except Exception as exc:  # noqa: BLE001 - keep sweeping on failure
            results[lang] = {"_error": str(exc)[:160]}
        print(
            f"[{i}/{len(LANGS)}] {lang:11s} {time.time()-t0:6.1f}s"
            f"  elapsed {(time.time()-started)/60:5.1f}m",
            flush=True,
        )
        with open("sweep_results.json", "w", encoding="utf-8") as fh:
            json.dump(results, fh, ensure_ascii=False, indent=1)
    print("DONE", round((time.time() - started) / 60, 1), "min", flush=True)


if __name__ == "__main__":
    main()
