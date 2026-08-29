# Contributing

Thanks for improving `dsh-computer-use` — the Linux X11 computer-use plugin for DeepSeek Harness.

## Prerequisites

- Linux X11 with a live `DISPLAY` (for end-to-end testing).
- `python3`, `libx11-6`, `libxtst6`, ImageMagick.
- Node.js for `index.js` development.

```sh
sudo apt install python3 libx11-6 libxtst6 imagemagick
```

## Quick check before a PR

Run the helper in isolation — it must print a single JSON object:

```sh
python3 xc.py info
python3 xc.py move 100 100
python3 xc.py cursor
```

Syntax-check the JS (no dependency install needed):

```sh
node --check index.js
```

The CI workflow in `.github/workflows/ci.yml` runs the same checks under Xvfb, so pull
requests get verified automatically.

## Adding or changing a tool

1. Add the subcommand to `xc.py` — each command prints **exactly one JSON object** to stdout
   and returns a non-zero exit on failure.
2. Register the tool in `index.js` with a JSON schema.
3. Update `README.md` (the tool table) and `examples.md`.

## Conventions

- Coordinates are native X11 pixels; never mix in image-downscaled coordinates.
- Keep `xc.py` zero-dependency (pure `ctypes`) — no pip installs.
- Use the system `libX11.so.6` / `libXtst.so.6` paths first so local conda/pip environments
  cannot shadow them.
- Document any new config key in the README's configuration table.

## Commit style

- Imperative subject line, short body explaining **why**.
- One logical change per commit.

## Security

This plugin grants full desktop control. Any change that broadens what the agent can do must be
called out in the PR and reflected in `SECURITY.md`.
