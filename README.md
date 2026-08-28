# NGenSTT — V2 vs V1

A demo for the two TNSA transcription engines and the speech-embedding model, built
around Indian and Arabic speech. Everything runs live against the GH200 instance;
nothing is mocked or pre-recorded.

## The two engines

| | Model id | Notes |
|---|---|---|
| **V2** | `ngenstt-v2-large` | QwenASR-1.7B. Strongest on Arabic and English. |
| **V2 Indic** | `ngenstt-v2-large` + AGen | Same acoustic model as V2, with the Qwen correction stage on top. |
| **V1 Indic** | `tnsa-ngen-stt-v1` + AGen | Acoustic pass plus the Qwen (`agen-multilingual-v1`) stage that rewrites Indic speech into its native script. |

The naming says exactly what each is: the number is the acoustic model, "Indic"
means the AGen correction stage is applied. All three are selectable everywhere —
playground, comparison, and benchmark — so you can judge them per language rather
than take a routing decision on trust.

### V2 cannot be forced to most Indic languages

Measured against the live box, `ngenstt-v2-large` accepts only
`auto`, `ar`, `en`, `hi`, `fa` as a forced `language`. Every other Indic code —
`te`, `ta`, `kn`, `ml`, `bn`, `mr`, `gu`, `pa`, `ur` — returns a bare **HTTP 500**,
not an error payload. `runEngine` downgrades an unsupported code to `auto` rather
than letting the request crash.

This also explains a failure that looks like mis-detection: V2 labels Telugu
speech as Hindi and writes it phonetically in Devanagari. It is not guessing
wrong — Hindi is the nearest Indic language its head actually covers. That is
the gap the Indic engine's correction pass exists to close.

**V2 is not reachable through `/stt`.** That endpoint validates model names against
its own registry and returns `unknown_model` for `ngenstt-v2-large`. V2 is only
available through the unified endpoints, passed as `stt_model`:

- `POST /outputs` — `model=tnsa-ngen-outputs-v1`, `stt_model=<engine>`,
  `include=embedding,transcript,languages,correction`
- `POST /v1/process` — `stt_model=<engine>`

This demo uses `/outputs`, which runs decode, STT windowing, language tagging,
script correction and the 1024-dim embedding server-side in a single call.
`lib/tnsa.ts` reads `models.stt` back off every response and throws if the server
ran a different engine than the one requested — a V2 column silently showing the
other engine's output would invalidate the whole comparison.

The Indic engine adds a second call to `POST /agen`
(`task: transcript_correction`). It costs roughly 8–18 s, which is why it is a
separate engine rather than always-on. If that call fails the acoustic transcript
is returned unchanged with `correctionError` set, so a correction outage never
loses a good result.

## Pages

| Route | What it does |
|---|---|
| `/` | **Playground.** Pick a clip, pick a model (V2 / V1 / both), read the transcript and the 1024-dim embedding it produced side by side. Switching models re-runs the same audio immediately. |
| `/compare` | **Comparison.** Both engines at once, scored against the reference, word-level diff, and a cross-engine language-disagreement check. |
| `/benchmark` | Two selectable suites — **ARen** (Arabic/English, 3 acoustic conditions, plus embedding robustness) and **Indic DiarBench** (22 Indic languages). |
| `/embeddings` | 1024-dim vectors with a cosine-similarity matrix across clips. |

Recording shows a live waveform with a level meter and a *no signal* warning, so a
dead mic is visible before you spend a round trip on it. Captured and sample clips
get a static waveform with a scrubable playhead.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in TNSA_API_KEY
npm run dev
```

Open http://localhost:3020.

The API key is read only in server route handlers. `lib/tnsa.ts` imports
`server-only`, so a build fails if it is ever pulled into a client component.

### Environment

| Variable | Purpose |
|---|---|
| `TNSA_API_BASE_URL` | Defaults to `https://embedding.tnsaai.com`. |
| `TNSA_API_KEY` | Required. |
| `HF_DATASET_REPO` | ARen dataset repo. Defaults to `TNSA/Aren`. |
| `HF_DATASET_REVISION` | Branch or commit. Defaults to `main`. |
| `HF_TOKEN` | Only if the dataset becomes private or gated. Public today. |
| `AREN_DIR` | **Local dev only.** Read the dataset from disk instead of Hugging Face. Leave unset in production. |
| `CUSTOM_AUDIO_DIR` | **Local dev only.** Drop-in folder for your own clips. |
| `DEMO_USER` / `DEMO_PASSWORD` | Sign-in credentials. Required. |
| `SESSION_SECRET` | HMAC key for the session cookie. Required. |
| `COOKIE_SECURE` | Set `true` only when serving over HTTPS. |

## Sign-in

Everything is behind a session cookie. `middleware.ts` gates all pages and API
routes: pages redirect to `/login` carrying where they were headed, API routes
return `401` JSON instead — a fetch that silently follows a redirect to an HTML
login page produces a confusing parse error at the call site.

The session is an HMAC-signed cookie (`HttpOnly`, `SameSite=Lax`, 12-hour expiry)
built on Web Crypto so the same code runs in middleware and in route handlers.
Credential checks are constant-time, and a wrong username and a wrong password
return the same message.

This is a gate on a demo, not an identity system — one account, no reset, no
lockout. If it ever needs real accounts, put it behind your existing SSO rather
than growing this.

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Audio

**Arabic and English** come from [ARen](https://huggingface.co/datasets/TNSA/Aren),
the Arabic/English ASR robustness set — 99 clips × 3 conditions (`clean`, `tel8k`,
`tel8k_noisy`), with references and stored baseline hypotheses, so a run is scored
the moment it lands.

The dataset is read **over HTTP from Hugging Face**, not from disk, so the app
deploys to a serverless host with no filesystem. Two details about that repo:

- The JSONL manifests are at the repo root, but their `file_name` fields
  (`data/clean/x.wav`) are relative to a nested `aren/` directory. The real object
  path is `aren/data/<condition>/<id>.wav` — using `file_name` verbatim 404s.
- Manifests are cached for an hour; audio is fetched per request and served to the
  browser by **302 redirect to the HF CDN**, so clip bytes never stream through a
  serverless function.

Set `AREN_DIR` to read from a local checkout instead — useful offline, and much
faster for long benchmark sweeps.

**Indian languages** have no bundled clips: ARen does not cover Indic audio.
Upload and record work for any language, and in local development anything dropped
into `CUSTOM_AUDIO_DIR` appears in the sample bank — prefix a filename with a
language code (`hi_loan_query.wav`, `ta-balance.wav`) to tag it.

The Indic handling itself is wired and ready: script detection across Devanagari,
Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada and Malayalam, a
wrong-script warning when the dominant script is not the language's native one,
and a **Force native script** control that drives `target_language` on the
correction pass. That last one is the interesting demo for Indic speech, where the
characteristic failure is not a mishearing but speech emitted phonetically into
the wrong script — Telugu written in Gujarati letters, for instance.

## Deploying to Vercel

Copy `.env.vercel.example` to `.env.vercel`, fill it in, and add those variables
to the Vercel project. `.env.vercel` is gitignored because it holds live secrets.

Set `COOKIE_SECURE=true` in production — Vercel serves HTTPS and the session
cookie should not travel without it. Leave `AREN_DIR` and `CUSTOM_AUDIO_DIR`
unset; serverless has no persistent filesystem and setting them breaks the
sample bank.

**Function duration is the one real constraint.** `/api/compare` and
`/api/benchmark` declare `maxDuration = 300`, but Vercel caps this by plan — 60 s
on Hobby, up to 300 s on Pro. A single comparison takes a few seconds and is fine
anywhere; a large benchmark sweep is not. Run big sweeps locally, or keep the clip
count low.

## Benchmarks

**ARen** — `TNSA/Aren`. 99 clips × 3 conditions, 2–40 s, single speaker. This is
the suite the published numbers come from and the only one whose WER is directly
comparable to them.

**Indic DiarBench** — `sarvamai/indic-diarbench`, 22 Indic languages. Read through
the HF datasets-server rows API, since each language config is a single ~1 GB
parquet with embedded audio that cannot be fetched per request.

Three things to know before quoting a DiarBench number:

- **Recordings are ~200 s with 6–8 speakers.** Measured WER is 93–98% for both
  engines, and it is dominated by *deletions* — roughly two thirds of the
  reference goes untranscribed. Neither engine attempts diarization, and the
  concatenated speaker-attributed reference charges them for overlap and turn
  boundaries. Treat it as a relative comparison between the two engines on Indic
  audio, never as an absolute accuracy figure, and never against ARen.
- **It is slow.** About 2 minutes per recording for both engines. 100 recordings
  is over three hours and will not complete inside any serverless function
  timeout. Run large sweeps locally.
- **Row counts vary by language** and are often under 100 — Telugu has 88.

Where it is genuinely useful is the script story. On one Telugu recording:

| Engine | WER | Output |
|---|---|---|
| V2 | 97.6% | `ये तो एक डिबेटेबल क्वेश्चन है।` — all Devanagari |
| V2 + AGen | 96.6% | partially converted — `అలీ పూరి ఇంకా ఆప్షన్…`, much still Devanagari |
| V2 Indic | 94.1% | `అప్పుడే ఇది…` — Telugu script throughout |

**Correction cannot retrofit a missing language head.** V2 + AGen barely improves
on bare V2 because AGen receives Devanagari text with no acoustic evidence that
the speech was Telugu, so it converts inconsistently. V2 Indic wins because its
acoustic model has a Telugu head to begin with. On a single 200 s recording where
everything scores 94–98% the one-point gaps are not significant; the script
difference is what to read.

### Shared acoustic passes

Engines that wrap the same acoustic model — V2 and V2 + AGen both run
`ngenstt-v2-large` — issue that model **once** per clip and derive the correction
variant from the shared result. Running it twice doubled GPU load for no new
information and pushed both requests past the gateway's 100 s limit, returning
HTTP 524 on long audio.

## Scoring

`lib/wer.ts` is a TypeScript port of the ARen reference scorer
(`aren/scripts/aren_eval.py`), verified to reproduce it exactly: `fleurs-ar_000`
clean scores 20.0% for V2 and 26.7% for V1, matching the dataset's stored
`ngenstt_v2_wer` (0.2) and `oaw_distillgen_wer` (0.2667).

Arabic normalisation (diacritic stripping, أ إ آ → ا, ة → ه, ى → ي) is applied
before scoring. Without it you measure orthographic convention rather than
recognition.

WER alone was what hid the failure ARen was built to expose, so the UI also
reports insertion rate separately (fabricated content shows up as insertions),
flags caption-scrape artifacts, and marks empty outputs.

### Cross-engine language disagreement

The script check compares output against the *claimed* language, so it cannot see
a failure where the language tag is itself wrong — Telugu speech labelled Hindi and
written phonetically in Devanagari looks internally consistent and passes. When the
two engines return different languages, `/compare` flags it: one of them is
transliterating rather than transcribing. This needs no reference text, so it works
on your own recordings.

The benchmark page aggregates **corpus WER** — total errors over total reference
words — not a mean of per-clip rates, so long and short clips are weighted
correctly.

## Measurements from this box

Single 8.2 s Arabic clip, telephony + noise:

| | V2 | V1 |
|---|---|---|
| WER | **13.3%** | 40.0% |
| Substitutions | 2 | 6 |
| Server-side total | 1.67 s | 1.87 s |

Relative latency is **not** stable across clips, so do not quote a single ratio.
On the Arabic clips sampled here V2 ran ~4× slower than V1 (1.6 s vs 0.37 s STT);
on a clean English clip it ran ~4.6× *faster* (490 ms vs 2290 ms). Use the
benchmark page over a real sample rather than any single measurement.

Embeddings are unit-normalised at 1024 dimensions. The same utterance across clean
and telephony+noise scores 0.822 cosine, against 0.753 for two different clean
utterances. The ordering is right but the margin is narrower than a
conversation-level cache threshold would want; treat that as a measurement to
follow up, not a proven result.
