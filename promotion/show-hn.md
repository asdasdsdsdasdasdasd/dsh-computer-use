# Show HN draft

**Title idea (keep under 80 chars):**
`Show HN: DeepSeek Harness plugin that drives a Linux X11 desktop (screenshot + mouse + keyboard)`

**Body:**

I built a small plugin that gives a DeepSeek Harness agent real control over a Linux X11 desktop —
not a browser sandbox, but the actual pointer and keyboard of your graphical session, via XTest.

I couldn't find a computer-use plugin that targeted Linux. The ones I saw were macOS-first
(Accessibility) or Windows-first (UI Automation / Win32 SendInput). So this is the Linux one:
a single zero-dependency Python helper (`xc.py`, pure `ctypes` → `libX11` + `libXtst`) plus a Cordis
layer that exposes 9 tools to the agent.

**What it gives the agent**
- `computer_screenshot` — full/region capture with `scale` + `region` so image pixels map back to
  native screen pixels
- `computer_move_mouse` / `computer_click` / `computer_drag` / `computer_scroll` — real input at
  native coordinates
- `computer_type` / `computer_key` — type text, send combos (`enter`, `ctrl+s`, `alt+F4`)
- `computer_cursor` / `computer_screen_info` — pointer position, geometry + XTest availability
- optional `observeAfterAction` — a fresh screenshot attached to every input so the model verifies
  each step

**Why it's light**
- no pip installs (stdlib + ctypes only)
- no Node native modules
- no accessibility framework
- just `python3`, `libX11`, `libXtst`, ImageMagick

**Install (one line):**
```
dsh plugin --profile web add github:asdasdsdsdasdasdasd/dsh-computer-use
```

Animated demo of it typing into a real terminal:
![demo](https://github.com/asdasdsdsdasdasdasd/dsh-computer-use/raw/main/demo/demo.gif)

**Caveat I want to be upfront about:** this is full desktop control. Default `sandboxMode` is
`danger-full-access`. Don't run it on a session with secrets on screen or a shared kiosk — I document
the risk model and mitigations (run on a throwaway Xvfb session, keep `observeAfterAction` on) in
`SECURITY.md`.

MIT licensed. Feedback welcome — especially on the input reliability edge cases and whether the
coordinate/scale handling is what people want.

Repo: https://github.com/asdasdsdsdasdasdasd/dsh-computer-use
