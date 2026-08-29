# Security Policy

dsh-computer-use gives LLM agents **full control of your real desktop**. Treat it accordingly.

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |
| < 0.1.0 | ❌ |

## Danger model

The plugin drives the real X11 pointer and keyboard through XTest. An agent with these tools can:

- **click anything on screen** — buttons, links, browser chrome, apps;
- **type anywhere** — including password fields, terminals, and destructive confirmations;
- **send key combos** — e.g. `ctrl+s`, `alt+F4`, `super+L`.

The default `sandboxMode` is `danger-full-access`. This is **not** a sandbox: it intentionally has
no confinement so that X11 input is unconfined.

## Who should (and shouldn't) enable it

**Enable only on:** a machine and OS account you are willing to let an LLM operate, a Linux X11
session that has no secrets on screen while the agent runs.

**Do not enable on:** shared kiosks, CI runners, headless/session-0 contexts, VMs with production
credentials, or any session where a password manager / private key / token sits visible.

## Reporting a vulnerability

Open a [security advisory](https://github.com/asdasdsdsdasdasdasd/dsh-computer-use/security/advisories/new)
or a GitHub issue with a minimal repro. This project is MIT-licensed experimental tooling; there is
no bug bounty.

## Mitigating the risk

- Run the agent on a **dedicated VM/container** with a throwaway X session (e.g. Xvfb) rather than
  your daily desktop. The plugin works fine on a virtual display.
- Don't keep sensitive windows open while the agent is active.
- Keep `observeAfterAction` on so the model sees the result of every input and can self-correct.
- Review `xc.py` and `index.js` before installing — it runs as your user.
