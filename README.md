# dsh-computer-use

![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-blue) ![Platform](https://img.shields.io/badge/platform-Linux%20X11-2ea44f) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![CI](https://github.com/asdasdsdsdasdasdasd/dsh-computer-use/actions/workflows/ci.yml/badge.svg)

A [DeepSeek Harness](https://github.com/deepseek-harness/deepseek-harness) plugin that lets the agent **see and operate a Linux X11 desktop**: screenshot, move/click/drag/scroll the mouse, type text, and send key combos.

> **The Linux/X11 computer-use plugin for DeepSeek Harness.** Most computer-use plugins target macOS or Windows — if your agent runs on a **Linux** box with a real graphical session, this is the one that works, with **zero heavy dependencies** (no Node native modules, no PowerShell, no accessibility framework).

This is **not** an official DeepSeek package. It drives the real pointer and keyboard through XTest. Treat it as full desktop control.


## Which computer-use plugin is right for you?

| Plugin | Platform | Approach |
| --- | --- | --- |
| **dsh-computer-use (this one)** | **Linux X11** | Python `ctypes` + **XTest** — screenshot + real mouse/keyboard |
| [Anionex/dsh-computer-use](https://github.com/Anionex/dsh-computer-use) | macOS | Accessibility-first |
| [ZRui-C/dsh-computer-use](https://github.com/ZRui-C/dsh-computer-use) | macOS | Accessibility-first + Chromium CDP |
| [jing-hy/computer-user](https://github.com/jing-hy/computer-user) | Windows | PowerShell + Win32 SendInput |
| [qphotoai/dsh-computer-use-windows](https://github.com/qphotoai/dsh-computer-use-windows) | Windows | UIA + cua-driver |

**Pick `dsh-computer-use` if your agent runs on Linux X11.** No Node build step, no PowerShell, no accessibility framework — just `python3`, `libX11`, `libXtst`, and ImageMagick.

## What it adds

| Tool | Action |
| --- | --- |
| `computer_screenshot` | Capture the screen (full or a region) as an image, with scale metadata so clicks stay accurate after downscaling |
| `computer_move_mouse` | Move the pointer to native screen pixels |
| `computer_click` | Move + click (button / repeat) |
| `computer_drag` | Drag between two points |
| `computer_scroll` | Wheel scroll at a point |
| `computer_type` | Type text into the focused window |
| `computer_key` | Send a key or combo (`enter`, `ctrl+s`, `alt+F4`) |
| `computer_cursor` | Read the current pointer position |
| `computer_screen_info` | Screen geometry + XTest availability |

See [examples.md](examples.md) for end-to-end usage.

Coordinates are **native X11 pixels**, not pixels of a downscaled screenshot. Every screenshot reports `scale` (and `region` offset) so:

`screen_xy = region_xy + image_xy * scale_xy`

## Requirements

Linux **X11** only. Not Wayland, macOS, or Windows.

- DeepSeek Harness (tested against 0.1.0-rc.8)
- A graphical session with `DISPLAY` set
- `python3`
- `libX11` and `libXtst` (`libx11-6` / `libxtst6` on Debian/Ubuntu)
- ImageMagick (`import`, `convert`, `identify`)

Debian/Ubuntu:

```sh
sudo bash scripts/install-deps.sh   # apt install python3 libx11-6 libxtst6 imagemagick
python3 xc.py info
```

`xc.py info` should print JSON with screen width/height and `"xtest": true`.

## How it works

The plugin ships a tiny Python helper `xc.py` that talks to the X server through `ctypes` (`libX11` + `libXtst`), so it needs **no external Python packages** and no Node native modules. Every input action reports the **native pixel coordinates the OS actually registered**, and every input action can optionally attach a fresh screenshot (`observeAfterAction`) so the model can immediately verify the result. See [architecture](docs/architecture.md) for the full design.

```text
DSH agent ──► index.js (Cordis tools) ──► xc.py (ctypes/libX11+libXtst) ──► X server ──► your desktop
```

## Install

Into an existing profile (replace `web` if you use another):

```sh
dsh plugin --profile web add github:asdasdsdsdasdasdasd/dsh-computer-use
```

Pin a commit so later pushes cannot change what you run:

```sh
dsh plugin --profile web add github:asdasdsdsdasdasdasd/dsh-computer-use#<sha>
```

From a local checkout:

```sh
dsh plugin --profile web add .
```

Restart the DSH process after install. Confirm the layer with:

```sh
dsh --profile web --dump-config
```

You should see a `# == dsh-computer-use` layer and a `computer-use` row.

### If you already use `dsh-tool-result-dedup`

Identical `computer_*` results (same click, same key) get collapsed as “omitted to save tokens”, which confuses the model. Skip that prefix in your **profile** `cordis.patch.yml`:

```yaml
- id: tool-result-dedup
  config:
    skipNamePrefixes:
      - computer_
```

## Security

Default `sandboxMode` is `danger-full-access`. The agent can click, type, and send shortcuts on **your real desktop** (including password fields, other apps, and destructive actions).

Only enable this plugin on a machine and account you are willing to let an LLM operate. Do not install it on a shared kiosk or a session with secrets on screen.

## Configuration

Override in the profile `cordis.patch.yml` (later layers replace the whole `config` object):

```yaml
- id: computer-use
  config:
    helper: /absolute/path/to/xc.py   # default: xc.py next to index.js
    shotDir: /tmp/dsh-computer-use
    defaultWidth: 1280
    sandboxMode: danger-full-access
    workspaceRoot: .
    observeAfterAction: true          # attach a screenshot after input actions
    nudgeAnnouncedTools: false
```

| Key | Default | Notes |
| --- | --- | --- |
| `helper` | `xc.py` beside this package | Python X11 helper |
| `shotDir` | `/tmp/dsh-computer-use` | Temporary screenshot files |
| `defaultWidth` | `1280` | Served-image width cap (vision tokens) |
| `sandboxMode` | `danger-full-access` | Needed for unconfined X11 input |
| `observeAfterAction` | `true` | Screenshot attached to click/type/key/… results |
| `nudgeAnnouncedTools` | `false` | Leave off; auto-followup can flood context |

**:warning: This is full desktop control.** Read [SECURITY.md](SECURITY.md) before enabling it on any machine you care about.

## License

MIT
