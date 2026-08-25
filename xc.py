#!/usr/bin/env python3
"""xc.py — minimal X11 computer-control helper (ctypes + XTest, no root needed).

Commands (each prints exactly one JSON object to stdout):
  info                                  screen geometry + XTest availability
  cursor                                current pointer position (native px)
  move <x> <y>                          absolute move, verified against XQueryPointer
  click <x> <y> [button=1] [clicks=1]   move, then N button presses
  drag <x1> <y1> <x2> <y2> [button=1]   move, hold, stepped drag, release
  scroll <x> <y> <delta>                positive = up, negative = down (steps)
  type <text|->                         type text; use '-' to read text from stdin
  key <combo>                           e.g. "ctrl+s", "enter", "alt+F4", "shift"
  resolve <combo>                       dry-run: report resolved keycodes, send nothing

Coordinates are NATIVE screen pixels of X screen 0 (the virtual screen).
Exit code 0 on success, 1 on failure (JSON {"error": ...} on stdout).
"""
import ctypes
import json
import os
import sys
import time

def _load(candidates):
    for path in candidates:
        try:
            return ctypes.CDLL(path)
        except OSError:
            continue
    print(json.dumps({"error": "cannot load any of: %s" % ", ".join(candidates)}))
    sys.exit(1)


# Prefer the distribution libraries by absolute path: local conda/pip
# environments ship their own libX11/libXtst that can shadow the system
# ones through rpath and misbehave against the running X server.
X11 = _load([
    "/usr/lib/x86_64-linux-gnu/libX11.so.6",
    "/usr/lib64/libX11.so.6",
    "/usr/lib/libX11.so.6",
    "libX11.so.6",
])
Xtst = _load([
    "/usr/lib/x86_64-linux-gnu/libXtst.so.6",
    "/usr/lib64/libXtst.so.6",
    "/usr/lib/libXtst.so.6",
    "libXtst.so.6",
])

# --- Xlib prototypes -------------------------------------------------------
X11.XOpenDisplay.argtypes = [ctypes.c_char_p]
X11.XOpenDisplay.restype = ctypes.c_void_p
X11.XCloseDisplay.argtypes = [ctypes.c_void_p]
X11.XCloseDisplay.restype = ctypes.c_int
X11.XDefaultScreen.argtypes = [ctypes.c_void_p]
X11.XDefaultScreen.restype = ctypes.c_int
X11.XScreenCount.argtypes = [ctypes.c_void_p]
X11.XScreenCount.restype = ctypes.c_int
X11.XDisplayWidth.argtypes = [ctypes.c_void_p, ctypes.c_int]
X11.XDisplayWidth.restype = ctypes.c_int
X11.XDisplayHeight.argtypes = [ctypes.c_void_p, ctypes.c_int]
X11.XDisplayHeight.restype = ctypes.c_int
X11.XRootWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
X11.XRootWindow.restype = ctypes.c_ulong
X11.XQueryPointer.argtypes = [
    ctypes.c_void_p, ctypes.c_ulong,
    ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong),
    ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_uint),
]
X11.XQueryPointer.restype = ctypes.c_int
X11.XFlush.argtypes = [ctypes.c_void_p]
X11.XFlush.restype = ctypes.c_int
X11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
X11.XSync.restype = ctypes.c_int
X11.XStringToKeysym.argtypes = [ctypes.c_char_p]
X11.XStringToKeysym.restype = ctypes.c_ulong
X11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
X11.XKeysymToKeycode.restype = ctypes.c_uint8
X11.XDisplayString.argtypes = [ctypes.c_void_p]
X11.XDisplayString.restype = ctypes.c_char_p

# --- XTest prototypes ------------------------------------------------------
Xtst.XTestQueryExtension.argtypes = [
    ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)]
Xtst.XTestQueryExtension.restype = ctypes.c_int
Xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
Xtst.XTestFakeMotionEvent.restype = ctypes.c_int
Xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
Xtst.XTestFakeButtonEvent.restype = ctypes.c_int
Xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
Xtst.XTestFakeKeyEvent.restype = ctypes.c_int

TYPE_DELAY = 0.012    # seconds between typed characters
KEY_GAP = 0.008       # press -> release gap for a single key
CLICK_GAP = 0.04      # button down -> up gap
CLICKS_GAP = 0.09     # gap between repeated clicks
DRAG_STEPS = 8
STEP_DELAY = 0.016
SCROLL_GAP = 0.024

# Friendly name -> X keysym name. Anything not listed is tried verbatim
# through XStringToKeysym (covers F1-F12, letters, punctuation, etc.).
ALIAS = {
    "enter": "Return", "return": "Return", "esc": "Escape", "escape": "Escape",
    "backspace": "BackSpace", "del": "Delete", "delete": "Delete",
    "tab": "Tab", "space": "space", "insert": "Insert",
    "home": "Home", "end": "End",
    "pgup": "Prior", "pageup": "Prior", "pgdn": "Next", "pagedown": "Next",
    "up": "Up", "down": "Down", "left": "Left", "right": "Right",
    "ctrl": "Control_L", "control": "Control_L", "shift": "Shift_L",
    "alt": "Alt_L", "altgr": "Alt_R", "super": "Super_L", "cmd": "Super_L", "win": "Super_L",
    "meta": "Meta_L", "capslock": "Caps_Lock", "numlock": "Num_Lock",
    "scrolllock": "Scroll_Lock", "menu": "Menu", "print": "Print",
    "screenshot": "Print",
}


def die(msg):
    print(json.dumps({"error": msg}))
    sys.exit(1)


def keysym_for_token(disp, token):
    t = token.strip()
    if not t:
        return None
    name = ALIAS.get(t.lower(), t)
    ks = X11.XStringToKeysym(name.encode("utf-8"))
    if ks == 0 and len(t) == 1:
        ks = ord(t)
    return ks or None


def keycode_for(disp, ks):
    kc = X11.XKeysymToKeycode(disp, ks)
    return kc or None


def open_display():
    disp = X11.XOpenDisplay(None)
    if not disp:
        die("cannot open X display (DISPLAY=%s)" % os.environ.get("DISPLAY"))
    return disp


def screen_size(disp):
    return (X11.XDisplayWidth(disp, 0), X11.XDisplayHeight(disp, 0))


def check_bounds(disp, x, y):
    w, h = screen_size(disp)
    if x < 0 or y < 0 or x >= w or y >= h:
        die("point (%d, %d) is outside the screen (%dx%d)" % (x, y, w, h))


def pointer_pos(disp):
    root = X11.XRootWindow(disp, 0)
    rw, cw = ctypes.c_ulong(), ctypes.c_ulong()
    rx, ry, wx, wy = ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
    mask = ctypes.c_uint()
    if not X11.XQueryPointer(disp, root, ctypes.byref(rw), ctypes.byref(cw),
                             ctypes.byref(rx), ctypes.byref(ry),
                             ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(mask)):
        die("XQueryPointer failed")
    return (rx.value, ry.value)


def move(disp, x, y):
    Xtst.XTestFakeMotionEvent(disp, 0, int(x), int(y), 0)
    X11.XFlush(disp)
    X11.XSync(disp, 0)


def button(disp, btn, down):
    Xtst.XTestFakeButtonEvent(disp, int(btn), 1 if down else 0, 0)
    X11.XFlush(disp)


def key(disp, kc):
    Xtst.XTestFakeKeyEvent(disp, int(kc), 1, 0)
    time.sleep(KEY_GAP)
    Xtst.XTestFakeKeyEvent(disp, int(kc), 0, 0)
    X11.XFlush(disp)


def parse_combo(disp, combo):
    """Resolve 'a+b+c' to [(name, keysym, keycode), ...]. Raises on unknown token."""
    out = []
    for token in combo.split("+"):
        ks = keysym_for_token(disp, token)
        if ks is None:
            die("unknown key name %r in combo %r" % (token, combo))
        kc = keycode_for(disp, ks)
        if kc is None:
            die("no keycode for %r in combo %r on this keyboard layout" % (token, combo))
        out.append((token.strip(), ks, kc))
    return out


def cmd_info(disp):
    w, h = screen_size(disp)
    # Verify XTEST with a no-op motion to the current pointer position: the
    # function returns 1 only when the XTEST extension actually generated the
    # event. (The X*QueryExtension entry points segfault under this system's
    # Python ctypes, so probe by behavior instead of by name.)
    x, y = pointer_pos(disp)
    xtest = bool(Xtst.XTestFakeMotionEvent(disp, 0, x, y, 0))
    X11.XFlush(disp)
    return {
        "display": X11.XDisplayString(disp).decode("utf-8", "replace"),
        "screens": X11.XScreenCount(disp),
        "width": w,
        "height": h,
        "xtest": xtest,
    }


def cmd_cursor(disp):
    x, y = pointer_pos(disp)
    return {"x": x, "y": y}


def cmd_move(disp, argv):
    x, y = int(argv[0]), int(argv[1])
    check_bounds(disp, x, y)
    move(disp, x, y)
    rx, ry = pointer_pos(disp)
    return {"requested": {"x": x, "y": y}, "actual": {"x": rx, "y": ry}}


def cmd_click(disp, argv):
    x, y = int(argv[0]), int(argv[1])
    btn = int(argv[2]) if len(argv) > 2 else 1
    clicks = int(argv[3]) if len(argv) > 3 else 1
    if btn not in (1, 2, 3) or not (1 <= clicks <= 10):
        die("button must be 1/2/3 and clicks 1..10")
    check_bounds(disp, x, y)
    move(disp, x, y)
    for i in range(clicks):
        if i:
            time.sleep(CLICKS_GAP)
        button(disp, btn, True)
        time.sleep(CLICK_GAP)
        button(disp, btn, False)
    X11.XSync(disp, 0)
    rx, ry = pointer_pos(disp)
    return {"x": x, "y": y, "button": btn, "clicks": clicks, "actual": {"x": rx, "y": ry}}


def cmd_drag(disp, argv):
    x1, y1, x2, y2 = (int(argv[0]), int(argv[1]), int(argv[2]), int(argv[3]))
    btn = int(argv[4]) if len(argv) > 4 else 1
    if btn not in (1, 2, 3):
        die("button must be 1/2/3")
    check_bounds(disp, x1, y1)
    check_bounds(disp, x2, y2)
    move(disp, x1, y1)
    button(disp, btn, True)
    for i in range(1, DRAG_STEPS + 1):
        ix = x1 + (x2 - x1) * i // DRAG_STEPS
        iy = y1 + (y2 - y1) * i // DRAG_STEPS
        move(disp, ix, iy)
        time.sleep(STEP_DELAY)
    button(disp, btn, False)
    X11.XSync(disp, 0)
    rx, ry = pointer_pos(disp)
    return {"from": {"x": x1, "y": y1}, "to": {"x": x2, "y": y2},
            "button": btn, "actual": {"x": rx, "y": ry}}


def cmd_scroll(disp, argv):
    x, y, delta = int(argv[0]), int(argv[1]), int(argv[2])
    if not (-50 <= delta <= 50) or delta == 0:
        die("delta must be a nonzero integer between -50 and 50")
    check_bounds(disp, x, y)
    move(disp, x, y)
    btn = 4 if delta > 0 else 5
    for _ in range(abs(delta)):
        button(disp, btn, True)
        time.sleep(SCROLL_GAP)
        button(disp, btn, False)
        time.sleep(SCROLL_GAP)
    X11.XSync(disp, 0)
    return {"x": x, "y": y, "delta": delta}


def cmd_type(disp, text):
    sent, failed = 0, []
    for ch in text:
        if ch in "\n\r":
            ks = 0xFF0D  # Return keysym
        elif ch == "\t":
            ks = 0xFF09  # Tab keysym
        else:
            o = ord(ch)
            if 32 <= o < 256:
                ks = o
            else:
                ks = 0x01000000 | o  # Unicode keysym
                kc = keycode_for(disp, ks)
                if kc is None:
                    ks = X11.XStringToKeysym(ch.encode("utf-8"))
        if not ks:
            failed.append(ch)
            continue
        kc = keycode_for(disp, ks)
        if kc is None:
            failed.append(ch)
            continue
        key(disp, kc)
        sent += 1
        time.sleep(TYPE_DELAY)
    out = {"sent": sent, "length": len(text)}
    if failed:
        out["unsent_chars"] = list(dict.fromkeys(failed))
    return out


def cmd_key(disp, argv, dry_run=False):
    combo = argv[0]
    resolved = parse_combo(disp, combo)
    if dry_run:
        return {"combo": combo,
                "keys": [{"name": n, "keysym": "0x%04x" % ks, "keycode": kc}
                         for (n, ks, kc) in resolved]}
    pressed = []
    for (_n, _ks, kc) in resolved:
        Xtst.XTestFakeKeyEvent(disp, kc, 1, 0)
        time.sleep(KEY_GAP)
        pressed.append(kc)
    for kc in reversed(pressed):
        Xtst.XTestFakeKeyEvent(disp, kc, 0, 0)
        time.sleep(KEY_GAP)
    X11.XSync(disp, 0)
    return {"combo": combo, "keys": len(resolved)}


def main():
    if len(sys.argv) < 2:
        die("usage: xc.py <info|cursor|move|click|drag|scroll|type|key|resolve> ...")
    cmd = sys.argv[1]
    argv = sys.argv[2:]
    disp = open_display()
    try:
        if cmd == "info":
            result = cmd_info(disp)
        elif cmd == "cursor":
            result = cmd_cursor(disp)
        elif cmd == "move":
            result = cmd_move(disp, argv)
        elif cmd == "click":
            result = cmd_click(disp, argv)
        elif cmd == "drag":
            result = cmd_drag(disp, argv)
        elif cmd == "scroll":
            result = cmd_scroll(disp, argv)
        elif cmd == "type":
            if not argv or argv[0] == "-":
                text = sys.stdin.read() if argv else ""
            else:
                text = argv[0]
            result = cmd_type(disp, text)
        elif cmd == "key":
            result = cmd_key(disp, argv)
        elif cmd == "resolve":
            result = cmd_key(disp, argv, dry_run=True)
        else:
            die("unknown command %r" % cmd)
        print(json.dumps(result))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - report any failure as JSON
        die("%s: %s" % (type(exc).__name__, exc))
    finally:
        X11.XCloseDisplay(disp)


if __name__ == "__main__":
    main()
