/**
 * dsh-computer-use
 *
 * Host-side computer control for a Linux X11 desktop. Registers model-facing
 * tools that drive the real screen and input devices through a Python helper
 * (ctypes -> libX11 + libXtst XTest), plus screen capture through ImageMagick:
 *
 *   computer_screenshot  capture the screen (full or a region) as an image with
 *                        exact coordinate-restore metadata
 *   computer_move_mouse  move the pointer to absolute native-screen pixels
 *   computer_click       move + click (button / repeat)
 *   computer_drag        drag between two points holding a button
 *   computer_scroll      wheel scroll at a point
 *   computer_type        type text into the focused window
 *   computer_key         send a key or key combination
 *   computer_cursor      read the current pointer position
 *   computer_screen_info read screen geometry + XTest availability
 *
 * Coordinate guarantee: input tools take NATIVE screen pixels of X screen 0.
 * The served screenshot may be downscaled to fit image limits / save vision
 * tokens, but every screenshot reports the exact `scale` (and `region` offset)
 * so screen_xy = region_xy + img_xy * scale_xy is lossless.
 *
 * Plain JavaScript, loaded directly by the cordis loader (no bundling).
 */

import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_HELPER = join(PACKAGE_DIR, 'xc.py')

export const name = 'computer-use'

export const inject = ['tools', 'systemPrompt']

export const Config = z.object({
  /** Absolute path to the Python X11 helper. Defaults to xc.py next to this file. */
  helper: z.string().default(DEFAULT_HELPER),
  /** Directory where captured screenshots are written. */
  shotDir: z.string().default('/tmp/dsh-computer-use'),
  /** Default served-image width cap (px); keeps vision tokens lean. */
  defaultWidth: z.number().step(1).min(320).max(2000).default(1280),
  /**
   * Sandbox file-effect mode for the shell calls this plugin makes. Mouse and
   * keyboard control need an unconfined session; workspace-write is refused
   * when no confinement backend is present.
   */
  sandboxMode: z
    .union([z.const('read-only'), z.const('workspace-write'), z.const('danger-full-access')])
    .default('danger-full-access'),
  /** workspaceRoot carried on the policy (not consumed by danger-full-access). */
  workspaceRoot: z.string().default('.'),
  /**
   * After key/click/type/scroll/drag/move, attach a screenshot to that same
   * tool result so the model does not have to announce computer_screenshot
   * and then stop.
   */
  observeAfterAction: z.boolean().default(true),
  /** Wake the agent once if it writes "let me screenshot" with no tool call. */
  nudgeAnnouncedTools: z.boolean().default(false),
})

/* ------------------------------------------------------------------ *
 * shell helpers
 * ------------------------------------------------------------------ */

function shellQuote(value) {
  const s = String(value)
  if (s.length === 0) return "''"
  if (/^[A-Za-z0-9_\-./+=:,@%]+$/.test(s)) return s
  return "'" + s.split("'").join("'\"'\"'") + "'"
}

async function runShell(shell, policy, command, timeoutMs, signal) {
  const request = { command, timeoutMs, sandboxPolicy: policy }
  if (signal !== undefined) request.signal = signal
  return shell.run(shell.resolve(request))
}

async function runHelper(shell, policy, helper, args, signal, stdin) {
  const request = {
    command: 'python3 ' + shellQuote(helper) + ' ' + args.map(shellQuote).join(' '),
    timeoutMs: 20000,
    sandboxPolicy: policy,
  }
  if (signal !== undefined) request.signal = signal
  if (stdin !== undefined) request.stdin = stdin
  const res = await shell.run(shell.resolve(request))
  if (res.timedOut) throw new Error('computer-use helper timed out after ' + res.timeoutMs + 'ms')
  let out
  try {
    out = JSON.parse(res.stdout.text)
  } catch {
    const detail = (((res.stderr.text || '').trim() + ' ' + (res.stdout.text || '').trim()).trim()).slice(0, 300)
    throw new Error('computer-use helper failed (exit ' + res.exitCode + ')' + (detail ? ': ' + detail : ''))
  }
  if (out === null || typeof out !== 'object' || Array.isArray(out)) {
    throw new Error('computer-use helper returned invalid JSON: ' + String(res.stdout.text).slice(0, 200))
  }
  if (out.error) throw new Error('computer-use: ' + out.error)
  return out
}

function requiredText(args, name) {
  if (args[name] === undefined || args[name] === null || !Object.prototype.hasOwnProperty.call(args, name)) {
    throw new Error(name + ' is required (non-empty string). Do not call this tool with {}.')
  }
  if (typeof args[name] !== 'string') {
    throw new Error(name + ' must be a string, not ' + typeof args[name])
  }
  const text = args[name]
  if (text === 'undefined' || text === 'null') {
    throw new Error(name + ' is required (non-empty string). Do not call this tool with {} or omit text.')
  }
  if (text.trim().length === 0) {
    throw new Error(name + ' must contain visible characters, not blank/whitespace. Example: {"text":"https://www.youtube.com"}')
  }
  return text
}

function intArg(args, name, min, max, dflt) {
  const v = args[name]
  if (v === undefined) return dflt
  const n = Number(v)
  if (!Number.isFinite(n) || Math.floor(n) !== n) throw new Error(name + ' must be an integer')
  if (n < min || n > max) throw new Error(name + ' must be between ' + min + ' and ' + max)
  return n
}

function round6(v) {
  return Math.round(v * 1e6) / 1e6
}

function policyFor(config, ctx) {
  // Prefer the session-scoped policy when the context exposes one; otherwise
  // fall back to the configured (deployment) mode.
  const fromCtx =
    ctx && ctx.get && (ctx.get('sandboxPolicy') || (ctx.sandbox && ctx.sandbox.policy))
  if (fromCtx && fromCtx.mode) return fromCtx
  return { mode: config.sandboxMode, workspaceRoot: config.workspaceRoot }
}

const COORD_NOTE =
  'Coordinates are NATIVE screen pixels (full-resolution screen space from computer_screen_info / screenshot metadata), not pixels of a downscaled screenshot image. Convert a point (ix, iy) read in a computer_screenshot image with x = ix * scale.x (+ region.x when a region was captured), y = iy * scale.y (+ region.y).'

/* ------------------------------------------------------------------ *
 * screenshot
 * ------------------------------------------------------------------ */

async function takeScreenshot(ctx, config, args, exec) {
  const fs = ctx.get('fs')
  const shell = ctx.get('shell')
  const attachments = ctx.get('attachments')
  const llm = ctx.get('llm')
  const policy = policyFor(config, ctx)
  const signal = exec ? exec.signal : undefined

  const stamp = String(Date.now())
  const native = config.shotDir + '/screen-' + stamp + '.png'
  const files = [native]
  let region = null
  let cap
  if (args.region) {
    const x = intArg(args.region, 'x', 0, 65535, 0)
    const y = intArg(args.region, 'y', 0, 65535, 0)
    const w = intArg(args.region, 'width', 1, 65535, 1)
    const h = intArg(args.region, 'height', 1, 65535, 1)
    cap = 'import -window root -crop ' + w + 'x' + h + '+' + x + '+' + y + ' ' + shellQuote(native)
    region = { x, y, width: w, height: h }
  } else {
    cap = 'import -window root ' + shellQuote(native)
  }
  const capRes = await runShell(shell, policy, 'mkdir -p ' + shellQuote(config.shotDir) + ' && ' + cap, 30000, signal)
  if (capRes.exitCode !== 0) throw new Error('screen capture failed: ' + (capRes.stderr.text || '').trim())

  const idRes = await runShell(shell, policy, 'identify -format "%w %h" ' + shellQuote(native) + ' | head -1', 10000, signal)
  const dims = (idRes.stdout.text || '').trim().split(/\s+/).map(Number)
  const nativeW = dims[0]
  const nativeH = dims[1]
  if (!Number.isFinite(nativeW) || !Number.isFinite(nativeH) || nativeW < 1 || nativeH < 1) {
    throw new Error('could not determine screenshot dimensions')
  }

  const info = await runHelper(shell, policy, config.helper, ['info'], signal)
  const screen = { width: info.width, height: info.height }

  const limits = attachments ? attachments.imageLimits : null
  let scale = 1
  if (limits && limits.maxImageDimension) scale = Math.min(scale, limits.maxImageDimension / Math.max(nativeW, nativeH))
  if (limits && limits.maxImagePixels) scale = Math.min(scale, Math.sqrt(limits.maxImagePixels / (nativeW * nativeH)))
  if (args.max_width !== undefined) {
    const mw = intArg(args, 'max_width', 320, 65535, 0)
    if (mw < nativeW) scale = Math.min(scale, mw / nativeW)
  } else if (config.defaultWidth < nativeW) {
    scale = Math.min(scale, config.defaultWidth / nativeW)
  }
  scale = Math.min(1, scale)

  let file = native
  let mediaType = 'image/png'
  let servedW = nativeW
  let servedH = nativeH
  if (scale < 1) {
    servedW = Math.max(64, Math.round(nativeW * scale))
    servedH = Math.max(64, Math.round(nativeH * scale))
    const scaled = native.replace(/\.png$/, '') + '.s.png'
    const conv = await runShell(shell, policy, 'convert ' + shellQuote(native) + ' -resize ' + servedW + 'x' + servedH + ' ' + shellQuote(scaled), 30000, signal)
    if (conv.exitCode !== 0) throw new Error('screenshot downscale failed: ' + (conv.stderr.text || '').trim())
    files.push(scaled)
    file = scaled
  }

  const maxBytes = limits && limits.maxImageBytes ? limits.maxImageBytes : Math.floor(3.5 * 1024 * 1024)
  let fits = false
  let round = 0
  while (!fits && round < 4) {
    const st = await runShell(shell, policy, 'stat -c %s ' + shellQuote(file), 10000, signal)
    const bytes = Number((st.stdout.text || '').trim())
    if (Number.isFinite(bytes) && bytes <= maxBytes) {
      fits = true
      break
    }
    round += 1
    if (mediaType === 'image/png') {
      const jpg = file.replace(/\.png$/, '') + '.j.jpg'
      const conv = await runShell(shell, policy, 'convert ' + shellQuote(file) + ' -quality 85 ' + shellQuote(jpg), 30000, signal)
      if (conv.exitCode !== 0) throw new Error('screenshot re-encode failed: ' + (conv.stderr.text || '').trim())
      files.push(jpg)
      file = jpg
      mediaType = 'image/jpeg'
    } else {
      servedW = Math.max(64, Math.round(servedW * 0.75))
      servedH = Math.max(64, Math.round(servedH * 0.75))
      const shrunk = native.replace(/\.png$/, '') + '.s' + round + '.jpg'
      const conv = await runShell(shell, policy, 'convert ' + shellQuote(native) + ' -resize ' + servedW + 'x' + servedH + ' -quality 85 ' + shellQuote(shrunk), 30000, signal)
      if (conv.exitCode !== 0) throw new Error('screenshot shrink failed: ' + (conv.stderr.text || '').trim())
      files.push(shrunk)
      file = shrunk
    }
  }
  if (!fits) throw new Error('screenshot still exceeds the ' + maxBytes + ' byte attachment budget after re-encoding')

  // Read the served bytes straight from disk (no fs service needed).
  const data = await readFile(resolvePath(file))

  let imageOk = false
  if (llm && exec && exec.agent) {
    const header = exec.agent.session && exec.agent.session.requestHeader ? exec.agent.session.requestHeader() : null
    const cfg = header && header.config ? header.config : null
    const provider = cfg && cfg.provider !== undefined ? cfg.provider : exec.agent.options.provider
    const model = cfg && cfg.model !== undefined ? cfg.model : exec.agent.options.model
    if (provider && model) {
      try {
        const active = await llm.resolveModelInfo(provider, model, signal)
        imageOk = Array.isArray(active.inputModalities) && active.inputModalities.indexOf('image') !== -1
      } catch {
        imageOk = false
      }
    }
  }

  let image = null
  if (imageOk && attachments) {
    const ext = mediaType === 'image/png' ? 'png' : 'jpg'
    const ref = await attachments.saveImage({ data, mediaType, name: 'screen-' + stamp + (region ? '-region' : '') + '.' + ext })
    image = { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height }
    if (ref.name !== undefined) image.name = ref.name
  }

  const junk = files.filter((p) => p !== file)
  if (junk.length) await rm(junk, { force: true }).catch(() => {})

  const value = {
    path: file,
    screen,
    scale: { x: round6(nativeW / servedW), y: round6(nativeH / servedH) },
  }
  if (region !== null) value.region = region
  if (image !== null) value.image = image
  return value
}

const screenshotRender = (args, value) => {
  const lines = []
  if (value.region) {
    lines.push('Screenshot of region (' + value.region.x + ', ' + value.region.y + ') ' + value.region.width + 'x' + value.region.height + ' native px')
  } else {
    lines.push('Screenshot (full screen)')
  }
  lines.push('Screen (native pixels): ' + value.screen.width + 'x' + value.screen.height)
  if (value.image) {
    lines.push('Served image: ' + value.image.width + 'x' + value.image.height + ' ' + value.image.mediaType + ', ' + value.image.bytes + ' bytes')
  }
  const rx = value.region ? value.region.x + ' + ' : ''
  const ry = value.region ? value.region.y + ' + ' : ''
  lines.push('Coordinate restore (image px -> screen px): screen_x = ' + rx + 'img_x * ' + value.scale.x + ' ; screen_y = ' + ry + 'img_y * ' + value.scale.y)
  lines.push('All computer_* input tools take these native screen pixel coordinates directly.')
  lines.push('Served image saved at: ' + value.path)
  const blocks = [{ type: 'text', text: lines.join('\n') }]
  if (value.image) blocks.push({ type: 'image', attachment: value.image })
  return blocks
}

const ANNOUNCE_EN =
  /\b(let me|i(?:'m| am) going to|i(?:'ll| will)|now (?:i(?:'ll| will)|let me)|next,? i(?:'ll| will)|i should now)\b/i
const ANNOUNCE_ACT =
  /\b(screenshot|computer_|click|type|press|key|omnibox|tab|scroll|drag)\b/i
const ANNOUNCE_ZH = /让我.{0,60}(截图|screenshot|点击|输入|调用)|接下来.{0,40}(截图|调用|点击)|现在.{0,40}(截图|调用)/
const NUDGE_PREFIX = 'Continue. You announced a tool but did not emit a tool call.'

function looksLikeAnnouncedTool(text) {
  const t = String(text || '').trim()
  if (t.length < 8 || t.length > 4000) return false
  if (ANNOUNCE_EN.test(t) && ANNOUNCE_ACT.test(t)) return true
  if (ANNOUNCE_ZH.test(t)) return true
  return false
}

function eventBlocks(event) {
  if (!event || !event.data) return []
  if (event.type === 'assistant/message' && event.data.message && Array.isArray(event.data.message.content)) {
    return event.data.message.content
  }
  return []
}

function lastAssistant(agent) {
  const events = agent && agent.session && agent.session.events
  if (!events || !events.length) return null
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.type !== 'assistant/message') continue
    const content = eventBlocks(ev)
    return {
      turn: ev.data && ev.data.turn,
      hasTool: content.some((b) => b && b.type === 'tool-call'),
      text: content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n'),
    }
  }
  return null
}

function turnUsedComputer(agent, turn) {
  const events = agent && agent.session && agent.session.events
  if (!events) return false
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (!ev.data || ev.data.turn !== turn) continue
    if (ev.type === 'tool/call' && String(ev.data.name || '').startsWith('computer_')) return true
    if (ev.type === 'assistant/message') {
      const content = eventBlocks(ev)
      if (content.some((b) => b && b.type === 'tool-call' && String(b.name || '').startsWith('computer_'))) return true
    }
  }
  return false
}

function installAnnounceNudge(ctx, config) {
  if (config.nudgeAnnouncedTools === false) return
  const counts = new WeakMap()
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || !agent || typeof agent.followup !== 'function') return
    const last = lastAssistant(agent)
    if (!last || last.hasTool || !looksLikeAnnouncedTool(last.text)) {
      counts.delete(agent)
      return
    }
    if (!turnUsedComputer(agent, last.turn)) return
    const n = (counts.get(agent) || 0) + 1
    counts.set(agent, n)
    if (n > 2) return
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{
        type: 'text',
        text:
          NUDGE_PREFIX
          + ' Emit that tool call now with no other text. If a screenshot is already attached to the previous computer_* result, look at it and continue the user task.',
      }],
      source: { kind: 'plugin', plugin: 'computer-use' },
    }
    setTimeout(() => {
      try {
        agent.followup(message)
      } catch {
        // Nudge is best-effort; a failed followup must not break the idle transition.
      }
    }, 0)
  })
}

/* ------------------------------------------------------------------ *
 * apply
 * ------------------------------------------------------------------ */

export function apply(ctx, config = {}) {
  const helper = config.helper || DEFAULT_HELPER

  ctx.systemPrompt.section({
    name: 'tool:computer-use',
    order: 121,
    text:
      'Computer-use tools control this X11 desktop directly. Call computer_screenshot first only when you do not already have a current observation image. '
      + 'Key/click/type/scroll/drag/move results already attach a screenshot of the screen AFTER that action — look at it; do not announce another screenshot. '
      + 'All mouse/keyboard tools take NATIVE screen pixels (see screenshot metadata / computer_screen_info); convert image pixels with the returned scale before clicking. '
      + 'Focus a window (click it) before typing. computer_key ALWAYS needs combo (string), e.g. combo="enter" or combo="ctrl+s". '
      + 'After a computer_* result, emit the next tool call immediately or give the final answer. Never write "let me take a screenshot" / "now I will click" and stop.',
  })

  const input = (make) => ({
    schema: { type: 'object', properties: {} },
    render: (_a, v) => [{ type: 'text', text: make(v) }],
  })

  const CONTINUE =
    'This result already includes a screenshot of the screen AFTER the action. Do not write "let me take a screenshot". Look at the attached image and either call the next computer_* tool or give the final answer. Never announce a tool in prose and stop.'

  const actionOutput = (makeText) => ({
    schema: { type: 'object', properties: {} },
    render: (_a, v) => {
      const blocks = [{ type: 'text', text: makeText(v) }]
      if (v.observation) {
        blocks.push({ type: 'text', text: CONTINUE })
        return blocks.concat(screenshotRender(_a, v.observation))
      }
      if (v.observationError) {
        blocks.push({
          type: 'text',
          text: 'Post-action screenshot failed: ' + v.observationError + '. Call computer_screenshot next — emit the tool call, do not announce it.',
        })
      }
      return blocks
    },
  })

  async function afterAction(exec, value) {
    if (config.observeAfterAction === false) return value
    try {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const observation = await takeScreenshot(ctx, config, {}, exec)
      return Object.assign({}, value, { observation })
    } catch (err) {
      return Object.assign({}, value, { observationError: err && err.message ? String(err.message) : String(err) })
    }
  }

  const shellPolicy = () => policyFor(config, ctx)
  const sh = () => ctx.get('shell')

  const int2 = (args, name) => {
    if (args[name] === undefined || args[name] === null) {
      throw new Error(name + ' is required (integer native screen pixels)')
    }
    return intArg(args, name, 0, 65535, 0)
  }

  const objectParams = (properties, required) => {
    const schema = { type: 'object', additionalProperties: false, properties }
    if (required && required.length) schema.required = required
    return schema
  }

  ctx.tools.register({
    name: 'computer_screenshot',
    description:
      'Capture the screen of this X11 desktop as an image and return it with exact coordinate-restore metadata. Optional region in native screen pixels; the served image is downscaled (default ~1280px wide) to save tokens, so always use the returned scale factors to convert image pixels back to original screen pixels.',
    parameters: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          additionalProperties: false,
          properties: {
            x: { type: 'integer', description: 'Left edge in native screen pixels.' },
            y: { type: 'integer', description: 'Top edge in native screen pixels.' },
            width: { type: 'integer', description: 'Width in native screen pixels.' },
            height: { type: 'integer', description: 'Height in native screen pixels.' },
          },
          required: ['x', 'y', 'width', 'height'],
          description: 'Optional screen region to capture, in native screen pixels.',
        },
        max_width: { type: 'integer', description: 'Override the served image width cap in pixels (uniform downscale).' },
      },
    },
    output: { schema: { type: 'object', properties: {} }, render: screenshotRender },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return takeScreenshot(ctx, config, args, exec)
    },
  })

  ctx.tools.register({
    name: 'computer_move_mouse',
    description: 'Move the mouse pointer to absolute coordinates and verify the result. ' + COORD_NOTE,
    parameters: objectParams({
      x: { type: 'integer', description: 'Target X in native screen pixels.' },
      y: { type: 'integer', description: 'Target Y in native screen pixels.' },
    }, ['x', 'y']),
    output: actionOutput((v) => 'Moved mouse: requested (' + v.requested.x + ', ' + v.requested.y + '), actual (' + v.actual.x + ', ' + v.actual.y + ')'),
    async execute(args, exec) {
      const value = await runHelper(sh(), shellPolicy(), helper, ['move', String(int2(args, 'x')), String(int2(args, 'y'))], exec ? exec.signal : undefined)
      return afterAction(exec, value)
    },
  })

  ctx.tools.register({
    name: 'computer_click',
    description: 'Move the mouse to a point and click. button: 1=left, 2=middle, 3=right; clicks: repeat count (2 = double click). ' + COORD_NOTE,
    parameters: objectParams({
      x: { type: 'integer', description: 'X in native screen pixels.' },
      y: { type: 'integer', description: 'Y in native screen pixels.' },
      button: { type: 'integer', description: '1=left (default), 2=middle, 3=right.' },
      clicks: { type: 'integer', description: 'Number of clicks, 1-10 (default 1).' },
    }, ['x', 'y']),
    output: actionOutput((v) => 'Clicked button ' + v.button + ' ' + v.clicks + 'x at (' + v.x + ', ' + v.y + ')'),
    async execute(args, exec) {
      const button = intArg(args, 'button', 1, 3, 1)
      const clicks = intArg(args, 'clicks', 1, 10, 1)
      const value = await runHelper(sh(), shellPolicy(), helper, ['click', String(int2(args, 'x')), String(int2(args, 'y')), String(button), String(clicks)], exec ? exec.signal : undefined)
      return afterAction(exec, value)
    },
  })

  ctx.tools.register({
    name: 'computer_drag',
    description: 'Drag from one point to another holding a mouse button. ' + COORD_NOTE,
    parameters: objectParams({
      x1: { type: 'integer', description: 'Start X in native screen pixels.' },
      y1: { type: 'integer', description: 'Start Y in native screen pixels.' },
      x2: { type: 'integer', description: 'End X in native screen pixels.' },
      y2: { type: 'integer', description: 'End Y in native screen pixels.' },
      button: { type: 'integer', description: '1=left (default), 2=middle, 3=right.' },
    }, ['x1', 'y1', 'x2', 'y2']),
    output: actionOutput((v) => 'Dragged button ' + v.button + ' from (' + v.from.x + ', ' + v.from.y + ') to (' + v.to.x + ', ' + v.to.y + ')'),
    async execute(args, exec) {
      const button = intArg(args, 'button', 1, 3, 1)
      const value = await runHelper(sh(), shellPolicy(), helper, ['drag', String(int2(args, 'x1')), String(int2(args, 'y1')), String(int2(args, 'x2')), String(int2(args, 'y2')), String(button)], exec ? exec.signal : undefined)
      return afterAction(exec, value)
    },
  })

  ctx.tools.register({
    name: 'computer_scroll',
    description: 'Scroll at a screen point. delta: positive = up, negative = down; each unit is one wheel step (max 50). ' + COORD_NOTE,
    parameters: objectParams({
      x: { type: 'integer', description: 'X in native screen pixels.' },
      y: { type: 'integer', description: 'Y in native screen pixels.' },
      delta: { type: 'integer', description: 'Nonzero scroll amount, -50..50 (positive = up).' },
    }, ['x', 'y', 'delta']),
    output: actionOutput((v) => 'Scrolled ' + (v.delta > 0 ? 'up' : 'down') + ' ' + Math.abs(v.delta) + ' step(s) at (' + v.x + ', ' + v.y + ')'),
    async execute(args, exec) {
      const delta = intArg(args, 'delta', -50, 50, 0)
      if (delta === 0) throw new Error('delta must be nonzero')
      const value = await runHelper(sh(), shellPolicy(), helper, ['scroll', String(int2(args, 'x')), String(int2(args, 'y')), String(delta)], exec ? exec.signal : undefined)
      return afterAction(exec, value)
    },
  })

  ctx.tools.register({
    name: 'computer_type',
    description:
      'Type text into the currently focused window. REQUIRED argument text: a non-empty string (not {}, not blank, not only spaces). Newlines send Enter; tabs send Tab. Click the target window first if it is not focused. Example: {"text":"https://www.youtube.com"}',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: {
          type: 'string',
          description: 'Required. Visible text to type. Empty string / whitespace is rejected.',
        },
      },
      required: ['text'],
    },
    output: actionOutput((v) => 'Typed ' + v.sent + ' char(s)' + (v.unsent_chars ? '; unsent: ' + v.unsent_chars.join(',') : '')),
    async execute(args, exec) {
      const text = requiredText(args, 'text')
      if (text.length > 10000) throw new Error('text too long (max 10000 chars)')
      const value = await runHelper(sh(), shellPolicy(), helper, ['type', '-'], exec ? exec.signal : undefined, text)
      return afterAction(exec, value)
    },
  })

  ctx.tools.register({
    name: 'computer_key',
    description:
      'Send a key or key combination to this X11 desktop. REQUIRED argument combo: a string such as "enter", "esc", "tab", "F5", "ctrl+s", "ctrl+shift+t", "alt+F4". Modifiers: ctrl, shift, alt, super (win/cmd). Do not call this tool without combo.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        combo: {
          type: 'string',
          description: 'Required. Key or combination joined with +, e.g. enter, ctrl+shift+t.',
        },
      },
      required: ['combo'],
    },
    output: actionOutput((v) => 'Executed computer_key this call: sent combo ' + v.combo + '.'),
    async execute(args, exec) {
      if (args.combo === undefined || args.combo === null) {
        throw new Error('computer_key requires combo (string), e.g. {"combo":"enter"} or {"combo":"ctrl+s"}')
      }
      const combo = String(args.combo).trim()
      if (combo.length === 0) throw new Error('combo must be non-empty')
      if (combo === 'undefined' || combo === 'null') {
        throw new Error('computer_key requires combo (string), e.g. {"combo":"enter"} — do not omit it')
      }
      if (!/^[A-Za-z0-9_+\-]+$/.test(combo)) throw new Error('combo may only contain letters, digits, + and - (e.g. "ctrl+shift+t", "enter", "F5")')
      const value = await runHelper(sh(), shellPolicy(), helper, ['key', combo], exec ? exec.signal : undefined)
      return afterAction(exec, value)
    },
  })

  ctx.tools.register({
    name: 'computer_cursor',
    description: 'Report the current mouse pointer position in NATIVE screen pixels.',
    parameters: objectParams({}),
    output: input((v) => 'Cursor at (' + v.x + ', ' + v.y + ')'),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return runHelper(sh(), shellPolicy(), helper, ['cursor'], exec ? exec.signal : undefined)
    },
  })

  ctx.tools.register({
    name: 'computer_screen_info',
    description: 'Report the screen geometry (native pixels) and XTest input-synthesis availability of this X11 desktop.',
    parameters: objectParams({}),
    output: input((v) => 'Display ' + v.display + ': ' + v.width + 'x' + v.height + ' (native px), screens=' + v.screens + ', xtest=' + v.xtest),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return runHelper(sh(), shellPolicy(), helper, ['info'], exec ? exec.signal : undefined)
    },
  })

  installAnnounceNudge(ctx, config)
}
