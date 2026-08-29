# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-29

### Added
- Initial release: 9 computer-use tools for DeepSeek Harness on Linux X11.
  - `computer_screenshot` — full-screen or region capture with `scale` + `region` metadata.
  - `computer_move_mouse`, `computer_click`, `computer_drag`, `computer_scroll` — native-pixel X11 input via XTest.
  - `computer_type`, `computer_key` — real keyboard input and key combos.
  - `computer_cursor`, `computer_screen_info` — pointer position and geometry/XTest availability.
- `xc.py` helper: zero-dependency Python (`ctypes` → `libX11` + `libXtst`) — no pip installs, no Node native modules.
- Per-action coordinate verification: every input reports the native pixels the OS registered.
- Optional `observeAfterAction` — attaches a fresh screenshot to input tool results for model-verifiable steps.
- MIT license.
