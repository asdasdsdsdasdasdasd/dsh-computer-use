# Examples

`dsh-computer-use` exposes the `computer_*` tools to the agent. All coordinates are
**native X11 pixels** of the primary screen. Every screenshot reports `scale` (and an optional
`region` offset), so convert an on-image point back to screen space with:

```
screen_xy = region_xy + image_xy * scale_xy
```

## See the screen

```text
computer_screenshot
```

Returns a PNG plus `scale` and `region`, so a clickable point `(ix, iy)` in the served image maps
to `screen = region + (ix, iy) * scale`.

## Move and click

```text
computer_move_mouse  x=1000  y=600
computer_click       x=1000  y=600  button=1  clicks=1
```

`computer_click` reports the exact native coords the X server registered, e.g.
`{"x":1000,"y":600,"button":1,"clicks":1,"actual":{"x":1000,"y":600}}`.

## Type and send keys

```text
computer_type   "hello world"
computer_key    "ctrl+s"
computer_key    "alt+F4"
```

Type text into whatever window is focused; send a combo to the focused window.

## Drag and scroll

```text
computer_drag   x1=400 y1=300 x2=900 y2=500  button=1
computer_scroll x=1000 y=700 delta=-4
```

Positive `delta` scrolls up; negative scrolls down.

## Inspect the display

```text
computer_screen_info
computer_cursor
```

`computer_screen_info` reports native screen geometry and whether XTest is available
(`"xtest": true`). `computer_cursor` reads the live pointer position.

## Calling the helper directly (outside DSH)

```sh
python3 xc.py info
python3 xc.py move 1000 600
python3 xc.py click 1000 600
python3 xc.py type "hello"
python3 xc.py key ctrl+s
python3 xc.py cursor
```
