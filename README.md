# NGenSTT — V2 vs V1

A demo for the two TNSA transcription engines and the speech-embedding model, built
around Indian and Arabic speech. Everything runs live against the GH200 instance;
nothing is mocked or pre-recorded.

## The two engines

| | Model id | Notes |
|---|---|---|
| **NGenSTT-V2-Large** | `ngenstt-v2-large` | Base: NGen-4-Lite-ASR. Current generation. |
| **OAW-DistillGen-AudioSTT** (V1) | `tnsa-ngen-stt-v1` | Whisper-derived. Faster, degrades sharply on real recordings. |

**V2 is not reachable through `/stt`.** That endpoint validates model names against
its own registry and returns `unknown_model` for `ngenstt-v2-large`. V2 is only
available through the unified endpoints, passed as `stt_model`:

- `POST /outputs` — `model=tnsa-ngen-outputs-v1`, `stt_model=<engine>`,
  `include=embedding,transcript,languages,correction`
- `POST /v1/process` — `stt_model=<engine>`

This demo uses `/outputs`, which runs decode, STT windowing, language tagging,
script correction and the 1024-dim embedding server-side in a single call.
`lib/tnsa.ts` reads `models.stt` back off every response and throws if the server
ran a different engine than the one requested — a V2 column silently showing V1
output would invalidate the whole comparison.

## Pages

| Route | What it does |
|---|---|
| `/` | **Playground.** Pick a clip, pick a model (V2 / V1 / both), read the transcript and the 1024-dim embedding it produced side by side. Switching models re-runs the same audio immediately. |
| `/compare` | **Comparison.** Both engines at once, scored against the reference, word-level diff, and a cross-engine language-disagreement check. |
| `/benchmark` | Published ARen results, a live streaming WER re-run across all three conditions, **and** embedding robustness — how far the vector moves as the channel degrades. |
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
| `AREN_DIR` | Path to the ARen dataset checkout. Enables the Arabic/English sample bank and live WER scoring. |
| `CUSTOM_AUDIO_DIR` | Drop-in folder for your own clips. |
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

**Arabic and English** come from ARen, the Arabic/English ASR robustness set —
99 clips × 3 conditions (`clean`, `tel8k`, `tel8k_noisy`), with references and
stored baseline hypotheses, so a run is scored the moment it lands.

**Indian languages** have no bundled clips: ARen does not cover Indic audio and
there is none elsewhere in the project. Upload and record work for any language,
and anything dropped into `CUSTOM_AUDIO_DIR` appears in the sample bank. Prefix a
filename with a language code — `hi_loan_query.wav`, `ta-balance.wav` — to tag it.

The Indic handling itself is wired and ready: script detection across Devanagari,
Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada and Malayalam, a
wrong-script warning when the dominant script is not the language's native one,
and a **Force native script** control that drives `target_language` on the
correction pass. That last one is the interesting demo for Indic speech, where the
characteristic failure is not a mishearing but speech emitted phonetically into
the wrong script — Telugu written in Gujarati letters, for instance.

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
