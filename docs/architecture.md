# Architecture

`dsh-computer-use` has two layers: a Cordis plugin (`index.js`) that exposes the `computer_*`
tools to the agent, and a small Python helper (`xc.py`) that actually talks to the X server.

```
DSH agent
   │  calls computer_click / computer_type / ...
   ▼
index.js  (Cordis plugin)
   │  spawns xc.py with a subcommand + JSON args
   ▼
xc.py  (ctypes → libX11 + libXtst)
   │  XTestFakeMotionEvent / XTestFakeButtonEvent / XTestFakeKeyEvent
   ▼
X server
   │
   ▼
your desktop
```

## index.js — the Cordis tool layer

- Registers each `computer_*` tool with a JSON schema.
- Spawns `xc.py` once per action, passing the command on argv and reading a single JSON object on
  stdout.
- For screenshots, saves the capture to `shotDir`, downscales to `defaultWidth`, and attaches the
  image plus `{scale, region}` metadata to the tool result so the model can map image pixels back to
  native screen pixels.
- When `observeAfterAction` is on, an input tool result is followed by a fresh screenshot.

## xc.py — the X11 driver

- Zero external Python dependencies: it uses `ctypes` to load `libX11.so.6` / `libXtst.so.6`.
- Tries known system paths first so local conda/pip environments cannot shadow the system libs and
  misbehave against the running server.
- Each command prints **exactly one JSON object** to stdout, e.g.:
  - `info` → `{display, screens, width, height, xtest}`
  - `move x y` → `{requested, actual}` (verified via `XQueryPointer`)
  - `click x y [button] [clicks]` → `{x, y, button, clicks, actual}`
  - `drag x1 y1 x2 y2 [button]` → `{from, to, actual}`
  - `scroll x y delta` → `{x, y, delta}`
  - `type text|–` → `{sent, length, unsent_chars?}`
  - `key combo` → `{combo, keys}`
  - `cursor` → `{x, y}`
- Coordinates are **native X11 pixels** of screen 0.

## Coordinate math

A served screenshot is downscaled from the natural capture. The model converts an on-image point
`(ix, iy)` back to a native screen point with:

```
screen_xy = region_xy + image_xy * scale_xy
```

where `scale` and `region` are reported with every screenshot.
