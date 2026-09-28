# FreeFlow Windows (Tauri track, spike 1)

Tray shell + transcription test + fork update check. No Swift, no macOS.

## Layout

- `src-tauri/` — Rust binary: tray icon (Show/Quit), hide-on-close window.
  `bundle.active` is false: plain `cargo build` produces a runnable exe,
  no installer bundler involved yet.
- `frontend/` — dependency-free HTML/JS. `frontend/lib/*.mjs` are one-way
  copies of `../companion/src/*.mjs` (re-copy after changing the core;
  a real bundler replaces this before any release).
- `scripts/make-icon.mjs` — generates `src-tauri/icons/*.png` (stdlib only).

## Build / run / install

Prerequisites (all present on this machine): Rust stable (MSVC target),
MSVC BuildTools linker, WebView2 runtime, Node 18+.

```powershell
node scripts/make-icon.mjs
Copy-Item ../companion/src/*.mjs frontend/lib/ -Force
cd src-tauri
cargo build            # dev exe: target/debug/freeflow-windows.exe
cargo build --release  # release exe: target/release/freeflow-windows.exe
```

Install = copy the release exe anywhere (e.g. `%LOCALAPPDATA%\FreeFlowWindows`)
plus an optional Start Menu shortcut. No registry, no services.

## Privacy

The API-key field lives in memory only and is never persisted, logged, or
sent anywhere except the configured provider as a Bearer header. Test audio
should be machine-generated (TTS) or a consenting sample — never real
dictation. The update check hits only the public fork releases API.

## Not in this spike

Mic capture (WASAPI), global hotkey, auto-paste/type, auto-start, installer
(NSIS/WiX), auto-update apply. The three buttons in the window are the full
test surface: cloud transcribe, local transcribe, fork update check.
