# FreeFlow Windows companion (Tauri track, spike 1)

Dependency-free portable transcription-pipeline cores ported from the macOS
Swift sources, plus the provider layer the Windows app needs. Runs on
Node 18+ with zero `npm install` (`node --test tests/`).

## Layout

- `src/transcriptText.mjs` — port of `Sources/TranscriptTextCore.swift`
  (response parsing, hallucination filter, output sanitizers, instruction guard)
- `src/modelConfig.mjs` — port of `Sources/ModelConfiguration.swift`
  (model lists, per-model config, think-tag stripping)
- `src/transcriptionProviders.mjs` — cloud (any OpenAI-compatible endpoint,
  Groq default) + local (localhost OpenAI-compatible server, e.g. whisper.cpp)
  transcription clients over a mocked-in-tests `fetch`
- `tests/` — `node:test` suite, synthetic fixtures only, no live network

## Run

```sh
cd companion
npm test        # node --test tests/
```

## Parity notes (vs Swift)

Faithful, including known quirks:
- Hallucination suppression threshold `0.1`, first-segment `no_speech_prob`.
- `stripThinkTags` only strips LEADING think blocks (Swift limitation);
  `stripAllThinkTags` is the improvement for callers that want every block gone.
- `config()` keeps legacy entries (`llama-*`, `allam-2-7b`, orpheus, ...)
  with the generic fallback, exactly like Swift.
- Content-type mapping (wav/mp3/m4a, default `audio/mp4`) and
  `friendlyHTTPMessage` texts match Swift.

Deliberate fixes:
1. Multipart filenames are sanitized (basename, drop `"`/CR/LF/controls).
   Swift interpolates the raw `lastPathComponent` into the header.
2. `transcribe*()` takes `Uint8Array` instead of reading a whole file, so a
   caller can stream/chunk large recordings (Swift uses `Data(contentsOf:)`).

New (no Swift equivalent): `transcribeWithLocalServer` — same parsing
pipeline, no API key, for offline/local-first use.

## Privacy

No real audio, transcripts, keys, prompts, or `.env` contents in code or
fixtures. Error strings carry the host only, never the API key.

## Roadmap to a real Windows app (not in this spike)

Tauri shell + Rust backend (needs Rust toolchain — absent on this machine),
WASAPI capture, global hotkey, `SendInput` paste, tray UI, updater, rename
(`APP_NAME`/`BUNDLE_ID`, `Info.plist`, `Sources/AppName.swift`, docs, update
feed as one change). Mic/hotkey/clipboard behavior needs documented manual
testing before any merge; unit tests here do not prove end-to-end behavior.
