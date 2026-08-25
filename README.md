# dsh-computer-use

A [DeepSeek Harness](https://github.com/deepseek-harness/deepseek-harness) plugin that lets the agent **see and operate a Linux X11 desktop**: screenshot, move/click/drag/scroll the mouse, type text, and send key combos.

This is **not** an official DeepSeek package. It drives the real pointer and keyboard through XTest. Treat it as full desktop control.

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
sudo apt install python3 libx11-6 libxtst6 imagemagick
python3 xc.py info
```

`xc.py info` should print JSON with screen width/height and `"xtest": true`.

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

## License

MIT
