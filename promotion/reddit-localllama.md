# Reddit r/LocalLLaMA draft

**Title:**
`I made a DeepSeek Harness plugin that drives a real Linux X11 desktop (screenshot + mouse + keyboard)`

**Flair suggestion:** Project | Open Source

**Body:**

Running DeepSeek Harness locally (Qwen / DeepSeek via llama.cpp) and wanted the agent to drive the
actual desktop — not a sandboxed browser — so it can click real apps, fill forms, and send keys.

Turned out every "computer-use" plugin I found was macOS-first (Accessibility) or Windows-first
(UI Automation / Win32). None targeted Linux X11 cleanly. So I wrote one.

**What it does**
- Drives the real X11 pointer and keyboard through XTest (`XTestFakeMotionEvent` / `FakeButtonEvent` /
  `FakeKeyEvent`).
- 9 tools: screenshot (full/region, with `scale`+`region` so pixels map back correctly),
  move/click/drag/scroll, type text, key combos, cursor, screen info.
- Optional `observeAfterAction` — attaches a fresh screenshot after every input action so the model
  can verify each step (which matters a lot when the model is a smaller local one).

**Why zero-heavy-deps matters if you're self-hosting**
A single Python helper (`xc.py`) using stdlib + `ctypes` means no pip installs, no Node native
modules, no accessibility framework. On a local setup that's just `python3 libx11-6 libxtst6
imagemagick` and you're done.

**Install (one line)**
```
dsh plugin --profile web add github:asdasdsdsdasdasdasd/dsh-computer-use
```
or, to pin a commit so nothing changes under you:
```
dsh plugin --profile web add github:asdasdsdsdasdasdasd/dsh-computer-use#<sha>
```

Animated demo of it typing into a real terminal:
![demo](https://github.com/asdasdsdsdasdasdasd/dsh-computer-use/raw/main/demo/demo.gif)

**The honest warning:** this is full desktop control. For local LLM setups I recommend running it
against a throwaway Xvfb session rather than your daily desktop, especially if you keep a password
manager open. Full risk model + mitigations in `SECURITY.md`.

MIT. Would appreciate feedback, especially on input reliability edge cases and the coordinate math.

Repo: https://github.com/asdasdsdsdasdasdasd/dsh-computer-use
