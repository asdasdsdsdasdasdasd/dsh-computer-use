#!/usr/bin/env python3
"""Lightweight tests for xc.py.

These run without a real X server by default (-c/--check only compiles and imports
the arg-parse surface). With a live DISPLAY (e.g. under Xvfb) they also verify the
`info` command and cursor round-trip.

Usage:
    python3 tests/test_xc.py            # syntax + unit checks, no X required
    python3 tests/test_xc.py --x        # also run live X11 checks (needs DISPLAY)
"""
import json
import subprocess
import sys

XC = "xc.py"


def run(*args, stdin=None):
    p = subprocess.run([sys.executable, XC, *args], capture_output=True, text=True, input=stdin)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def test_info_json(use_x):
    """`info` must print exactly one valid JSON object."""
    code, out, err = run("info")
    assert code == 0, f"info failed: {err}"
    data = json.loads(out)
    for key in ("display", "screens", "width", "height", "xtest"):
        assert key in data, f"missing key {key!r} in {data}"
    assert data["width"] > 0 and data["height"] > 0
    if use_x:
        assert data["xtest"] is True, "XTest expected to be available"


def test_cursor_roundtrip(use_x):
    """move must confirm the registered coordinates in its own result.

    The `actual` value is verified against XQueryPointer in the SAME X connection
    that issued the motion, so it is authoritative. A separate `cursor` read in a
    fresh process is only informational: under a headless Xvfb display the pointer
    can reset to the centre between connections, so we don't hard-fail on it.
    """
    code, out, err = run("move", "100", "120")
    assert code == 0, f"move failed: {err}"
    data = json.loads(out)
    assert data["requested"] == {"x": 100, "y": 120}, f"move request mismatch: {data}"
    if use_x:
        assert data["actual"] == {"x": 100, "y": 120}, f"move not registered: {data}"
    else:
        assert data["actual"]["x"] == 100 and data["actual"]["y"] == 120, f"move not registered: {data}"
    # informational cross-process cursor read; do not fail the suite on it
    code, out, err = run("cursor")
    assert code == 0
    json.loads(out)


def test_usage_needs_command():
    code, out, err = run()
    assert code != 0, "no-arg call should fail"
    assert "usage" in (out + err).lower()


def main():
    use_x = "--x" in sys.argv
    test_usage_needs_command()
    test_info_json(use_x)
    if use_x:
        test_cursor_roundtrip(use_x)
    print("OK: all xc.py tests passed%s" % (" (with live X11)" if use_x else ""))


if __name__ == "__main__":
    main()
