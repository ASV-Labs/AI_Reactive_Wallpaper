/**
 * hermes-neon-h — Animated neon H mark for Hermes Desktop.
 * ASV Labs / Charles Bonetti. Opt-in disk plugin (defaultEnabled: false).
 * v1.1.0 — Pets-like floating in-window widget by default (not a docked pane).
 *
 * Install: copy this folder to $HERMES_HOME/desktop-plugins/hermes-neon-h/
 * (default HERMES_HOME=~/.hermes), then ⌘K → Reload desktop plugins.
 *
 * Plain ESM, uncompiled. Only these imports resolve:
 *   @hermes/plugin-sdk, react, react/jsx-runtime
 *
 * Status polling is polite (~45–60s). Prefer statuspage JSON with CORS *.
 * Floating panes are dragged by the Hermes title/header chrome (SDK).
 */

import {
  host,
  haptic,
  Tip,
  cn,
  atom,
  useValue,
  useQuery,
  Button,
  Input,
  Switch,
  ScrollArea,
  Separator,
  Badge,
  PALETTE_AREA,
  STATUSBAR_AREAS,
  PANES_AREA
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-neon-h'
const POLL_MS = 50000

const DEFAULT_COLORS = {
  openai: '#10a37f',
  anthropic: '#d4a27f',
  google: '#4285f4',
  xai: '#ff6b2c',
  hermes: '#ff6b2c',
  warn: '#f59e0b',
  major: '#ef4444',
  unknown: '#94a3b8'
}

/**
 * Watched providers. `kind`:
 *   statuspage — Atlassian Statuspage /api/v2/summary.json
 *   gcp        — Google Cloud incidents.json (proxy for Gemini; see README)
 *   xai        — status.x.ai JSON first, HTML keyword sniff fallback
 */
const PROVIDER_DEFS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    short: 'OAI',
    kind: 'statuspage',
    url: 'https://status.openai.com/api/v2/summary.json',
    hints: ['openai', 'gpt', 'o1', 'o3', 'o4', 'chatgpt']
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    short: 'ANT',
    kind: 'statuspage',
    url: 'https://status.claude.com/api/v2/summary.json',
    hints: ['anthropic', 'claude', 'sonnet', 'opus', 'haiku']
  },
  google: {
    id: 'google',
    label: 'Google',
    short: 'GOOG',
    kind: 'gcp',
    url: 'https://status.cloud.google.com/incidents.json',
    hints: ['google', 'gemini', 'bard', 'vertex', 'palm']
  },
  xai: {
    id: 'xai',
    label: 'xAI',
    short: 'xAI',
    kind: 'xai',
    url: 'https://status.x.ai/api/v2/summary.json',
    htmlUrl: 'https://status.x.ai/',
    hints: ['xai', 'x.ai', 'grok']
  }
}

const ANIM_MODES = [
  { value: 'breathe', label: 'Breathe' },
  { value: 'static', label: 'Static' },
  { value: 'pulse-on-busy', label: 'Pulse on busy' },
  { value: 'outage-flash', label: 'Outage flash' }
]

const STORAGE_KEYS = {
  colors: 'colors',
  animMode: 'animMode',
  watched: 'watched',
  panePlacement: 'panePlacement',
  scale: 'scale'
}

// Four edge docks use the workspace dock contract. `floating` is Hermes'
// draggable in-window pane surface; it is not a CSS overlay or a top placement.
// Default product surface is floating (small sprite-like mark), not a dock edge.
const PANE_PLACEMENTS = ['floating', 'bottom', 'top', 'left', 'right']
const DEFAULT_PLACEMENT = 'floating'
const FLOAT_BASE_PX = 160
const SCALE_MIN = 0.5
const SCALE_MAX = 2.0
const DEFAULT_SCALE = 1

const DEFAULT_WATCHED = ['openai', 'anthropic', 'google', 'xai']

let _storage = null

/** Shared settings atom — MarkPane / SettingsPane / chips all subscribe via useValue. */
const $settings = atom({
  colors: Object.assign({}, DEFAULT_COLORS),
  animMode: 'breathe',
  watched: DEFAULT_WATCHED.slice(),
  panePlacement: DEFAULT_PLACEMENT,
  scale: DEFAULT_SCALE
})

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function mapStatuspageIndicator(indicator) {
  const v = String(indicator || '').toLowerCase()
  if (v === 'none' || v === 'operational') return 'operational'
  if (v === 'minor') return 'degraded'
  if (v === 'major' || v === 'critical') return 'major'
  return 'unknown'
}

async function fetchStatuspage(url) {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const data = await res.json()
  const indicator = data && data.status ? data.status.indicator : null
  return {
    status: mapStatuspageIndicator(indicator),
    description: (data && data.status && data.status.description) || indicator || '',
    source: 'statuspage'
  }
}

/** Open only if end is missing/null/empty OR end date is in the future. */
function isGcpIncidentOpen(inc) {
  if (!inc) return false
  const end = inc.end != null ? inc.end : inc.end_date != null ? inc.end_date : null
  if (end == null || end === '') return true
  const t = Date.parse(String(end))
  if (Number.isNaN(t)) return true
  return t > Date.now()
}

async function fetchGcpIncidents(url) {
  // Honest proxy: GCP public incidents, not a dedicated Gemini consumer page.
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const incidents = await res.json()
  if (!Array.isArray(incidents) || incidents.length === 0) {
    return { status: 'operational', description: 'No open GCP incidents', source: 'gcp' }
  }
  const open = incidents.filter(isGcpIncidentOpen)
  if (open.length === 0) {
    return { status: 'operational', description: 'No open GCP incidents', source: 'gcp' }
  }
  let worst = 'degraded'
  for (let i = 0; i < open.length; i++) {
    const inc = open[i]
    const sev = String((inc && (inc.severity || inc.highest_severity)) || '').toLowerCase()
    if (sev.indexOf('high') !== -1 || sev.indexOf('critical') !== -1 || sev === 'major') {
      worst = 'major'
      break
    }
  }
  return {
    status: worst,
    description: open.length + ' open GCP incident(s)',
    source: 'gcp'
  }
}

function sniffXaiHtml(html) {
  const text = String(html || '').toLowerCase()
  if (
    /all systems? (are )?operational/.test(text) ||
    /status[^a-z]{0,24}operational/.test(text) ||
    />\s*operational\s*</.test(text)
  ) {
    return { status: 'operational', description: 'HTML sniff: operational', source: 'xai-html' }
  }
  if (/major outage|critical|service disruption/.test(text)) {
    return { status: 'major', description: 'HTML sniff: major', source: 'xai-html' }
  }
  if (/degraded|partial outage|minor/.test(text)) {
    return { status: 'degraded', description: 'HTML sniff: degraded', source: 'xai-html' }
  }
  return { status: 'unknown', description: 'HTML sniff inconclusive', source: 'xai-html' }
}

async function fetchXai(def) {
  try {
    return await fetchStatuspage(def.url)
  } catch (_e) {
    // fall through to HTML
  }
  try {
    const res = await fetch(def.htmlUrl, { credentials: 'omit', cache: 'no-store' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const html = await res.text()
    return sniffXaiHtml(html)
  } catch (e) {
    return {
      status: 'unknown',
      description: (e && e.message) || 'xAI status unreachable',
      source: 'xai-failed',
      error: true
    }
  }
}

async function fetchProviderStatus(def) {
  try {
    if (def.kind === 'statuspage') return await fetchStatuspage(def.url)
    if (def.kind === 'gcp') return await fetchGcpIncidents(def.url)
    if (def.kind === 'xai') return await fetchXai(def)
    return { status: 'unknown', description: 'Unsupported kind', source: 'none', error: true }
  } catch (e) {
    return {
      status: 'unknown',
      description: (e && e.message) || 'fetch failed',
      source: 'error',
      error: true
    }
  }
}

async function fetchAllStatuses(watched) {
  const ids = watched && watched.length ? watched : DEFAULT_WATCHED
  const entries = await Promise.all(
    ids.map(async (id) => {
      const def = PROVIDER_DEFS[id]
      if (!def) {
        return [id, { status: 'unknown', description: 'unknown provider', source: 'none', error: true }]
      }
      const result = await fetchProviderStatus(def)
      return [id, Object.assign({}, result, { id: id, label: def.label, short: def.short })]
    })
  )
  const out = {}
  for (let i = 0; i < entries.length; i++) {
    out[entries[i][0]] = entries[i][1]
  }
  return out
}

// ---------------------------------------------------------------------------
// Active provider parsing
// ---------------------------------------------------------------------------

function parseProviderHint(model, profile) {
  const blob = String(model || '') + ' ' + String(profile || '')
  const lower = blob.toLowerCase()
  const order = ['anthropic', 'openai', 'google', 'xai']
  for (let i = 0; i < order.length; i++) {
    const id = order[i]
    const hints = (PROVIDER_DEFS[id] && PROVIDER_DEFS[id].hints) || []
    for (let j = 0; j < hints.length; j++) {
      if (lower.indexOf(hints[j]) !== -1) return id
    }
  }
  return null
}

function clampScale(value) {
  const n = typeof value === 'number' ? value : parseFloat(value)
  if (!Number.isFinite(n)) return DEFAULT_SCALE
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(n * 100) / 100))
}

function floatSizePx(scale) {
  return Math.max(80, Math.round(FLOAT_BASE_PX * clampScale(scale)))
}

function loadSettings() {
  const storedColors = _storage ? _storage.get(STORAGE_KEYS.colors, null) : null
  const colors = Object.assign({}, DEFAULT_COLORS, storedColors || {})
  const animMode = (_storage && _storage.get(STORAGE_KEYS.animMode, 'breathe')) || 'breathe'
  const watched = (_storage && _storage.get(STORAGE_KEYS.watched, DEFAULT_WATCHED)) || DEFAULT_WATCHED
  const storedPlacement =
    (_storage && _storage.get(STORAGE_KEYS.panePlacement, DEFAULT_PLACEMENT)) || DEFAULT_PLACEMENT
  const panePlacement =
    PANE_PLACEMENTS.indexOf(storedPlacement) !== -1 ? storedPlacement : DEFAULT_PLACEMENT
  const storedScale = _storage ? _storage.get(STORAGE_KEYS.scale, DEFAULT_SCALE) : DEFAULT_SCALE
  const scale = clampScale(storedScale)
  return {
    colors: colors,
    animMode: animMode,
    watched: watched,
    panePlacement: panePlacement,
    scale: scale
  }
}

function paneDataFor(placement, scale) {
  if (placement === 'floating') {
    const px = floatSizePx(scale == null ? DEFAULT_SCALE : scale)
    return {
      placement: 'floating',
      anchor: 'bottom-right',
      width: px + 'px',
      height: px + 'px'
    }
  }
  // Do not use `placement: 'top'`: top is a dock position, while `main` +
  // `dock` is the SDK contract for every workspace edge.
  const edge = PANE_PLACEMENTS.indexOf(placement) !== -1 ? placement : 'bottom'
  const horizontal = edge === 'left' || edge === 'right'
  return {
    placement: 'main',
    dock: { pane: 'workspace', pos: edge },
    ...(horizontal ? { width: '260px' } : { height: '200px' })
  }
}

function savePartial(key, value) {
  if (_storage) _storage.set(key, value)
}

// ---------------------------------------------------------------------------
// Color / visual mapping
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return { r: 255, g: 107, b: 44 }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  }
}

function statusColor(status, providerId, colors) {
  if (status === 'major') return colors.major || DEFAULT_COLORS.major
  if (status === 'degraded') return colors.warn || DEFAULT_COLORS.warn
  if (status === 'unknown' || status === 'loading') return colors.unknown || DEFAULT_COLORS.unknown
  return colors[providerId] || colors.hermes || DEFAULT_COLORS.xai
}

function pulseParams(status, animMode, busy) {
  let amp = 0.18
  let speed = 1.0
  let flash = false

  if (animMode === 'static') {
    amp = 0
    speed = 0
  } else if (animMode === 'pulse-on-busy') {
    amp = busy ? 0.4 : 0.08
    speed = busy ? 2.4 : 0.55
  } else if (animMode === 'outage-flash') {
    if (status === 'major') {
      amp = 0.6
      speed = 4.8
      flash = true
    } else if (status === 'degraded') {
      amp = 0.35
      speed = 2.5
    } else {
      amp = 0.14
      speed = 1.0
    }
  } else {
    // breathe (default)
    if (status === 'major') {
      amp = 0.55
      speed = 3.6
      flash = true
    } else if (status === 'degraded') {
      amp = 0.32
      speed = 2.1
    } else if (status === 'unknown' || status === 'loading') {
      amp = 0.14
      speed = 0.75
    } else {
      amp = 0.22
      speed = 1.05
    }
  }

  if (busy && animMode !== 'static') {
    amp = Math.min(0.75, amp * 1.6)
    speed *= 1.5
  }
  return { amp: amp, speed: speed, flash: flash }
}

// ---------------------------------------------------------------------------
// Procedural neon H (logo geometry — never draw opaque PNG rect)
// Square frame with top/bottom center gaps; dual inward C/U uprights + bridge.
// ---------------------------------------------------------------------------

/**
 * Trace the stylized H into the current path (caller beginPath/fill/stroke).
 * Coordinate space: unit box [-1,-1]..[1,1] centered; scale applied by caller.
 */
function traceNeonHPath(ctx2d) {
  // Outer square frame with top & bottom center gaps.
  // Left half of frame (like a tall C opening right):
  const o = 0.92 // outer half-extent
  const t = 0.14 // frame thickness
  const gap = 0.22 // half-width of top/bottom gap
  const i = o - t // inner edge of frame

  // --- Outer frame: left C ---
  ctx2d.moveTo(-gap, -o)
  ctx2d.lineTo(-o, -o)
  ctx2d.lineTo(-o, o)
  ctx2d.lineTo(-gap, o)
  ctx2d.lineTo(-gap, i)
  ctx2d.lineTo(-i, i)
  ctx2d.lineTo(-i, -i)
  ctx2d.lineTo(-gap, -i)
  ctx2d.closePath()

  // --- Outer frame: right C (mirror) ---
  ctx2d.moveTo(gap, -o)
  ctx2d.lineTo(o, -o)
  ctx2d.lineTo(o, o)
  ctx2d.lineTo(gap, o)
  ctx2d.lineTo(gap, i)
  ctx2d.lineTo(i, i)
  ctx2d.lineTo(i, -i)
  ctx2d.lineTo(gap, -i)
  ctx2d.closePath()

  // Inner dual uprights: inward C/U forms + center bridge.
  // Left upright (opens inward / right):
  const ux = 0.42 // outer x of upright
  const uxIn = 0.18 // inner x of upright stem
  const uy = 0.58 // upright height half
  const uThick = 0.14
  const bridgeHalfH = 0.1
  const bridgeHalfW = 0.22

  // Left U/C: outer vertical + inward arms at top/bottom into the bridge zone
  ctx2d.moveTo(-ux, -uy)
  ctx2d.lineTo(-uxIn, -uy)
  ctx2d.lineTo(-uxIn, -uy + uThick)
  ctx2d.lineTo(-ux + uThick, -uy + uThick)
  ctx2d.lineTo(-ux + uThick, uy - uThick)
  ctx2d.lineTo(-uxIn, uy - uThick)
  ctx2d.lineTo(-uxIn, uy)
  ctx2d.lineTo(-ux, uy)
  ctx2d.closePath()

  // Right U/C (mirror)
  ctx2d.moveTo(ux, -uy)
  ctx2d.lineTo(uxIn, -uy)
  ctx2d.lineTo(uxIn, -uy + uThick)
  ctx2d.lineTo(ux - uThick, -uy + uThick)
  ctx2d.lineTo(ux - uThick, uy - uThick)
  ctx2d.lineTo(uxIn, uy - uThick)
  ctx2d.lineTo(uxIn, uy)
  ctx2d.lineTo(ux, uy)
  ctx2d.closePath()

  // Center bridge
  ctx2d.moveTo(-bridgeHalfW, -bridgeHalfH)
  ctx2d.lineTo(bridgeHalfW, -bridgeHalfH)
  ctx2d.lineTo(bridgeHalfW, bridgeHalfH)
  ctx2d.lineTo(-bridgeHalfW, bridgeHalfH)
  ctx2d.closePath()
}

function drawNeonH(ctx2d, w, h, opts) {
  const color = opts.color
  const amp = opts.amp
  const speed = opts.speed
  const flash = opts.flash
  const t = opts.t
  const busy = opts.busy
  const userScale = clampScale(opts.userScale == null ? 1 : opts.userScale)
  const rgb = hexToRgb(color)
  const cx = w / 2
  const cy = h / 2
  const base = Math.min(w, h) * 0.38 * userScale

  const phase = speed > 0 ? (Math.sin(t * speed * 2.2) + 1) / 2 : 0.5
  let breath = 1 - amp + amp * phase
  if (flash) {
    const f = (Math.sin(t * speed * 8) + 1) / 2
    breath = 0.3 + 0.7 * f
  }
  if (busy) breath = Math.min(1.2, breath * 1.1)

  // Visible per-frame changes: scale + glow radius + alpha
  const scale = base * (0.88 + 0.18 * breath)
  const glowBlur = 10 + 48 * amp * breath + (busy ? 18 : 0)
  const coreAlpha = 0.55 + 0.45 * breath
  const glowAlpha = 0.25 + 0.55 * breath

  ctx2d.clearRect(0, 0, w, h)
  ctx2d.fillStyle = '#000000'
  ctx2d.fillRect(0, 0, w, h)

  // Soft ambient glow behind the mark
  const glowR = scale * (1.35 + 0.55 * breath)
  const g = ctx2d.createRadialGradient(cx, cy, scale * 0.15, cx, cy, glowR)
  g.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + 0.45 * breath + ')')
  g.addColorStop(0.4, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + 0.14 * breath + ')')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx2d.fillStyle = g
  ctx2d.fillRect(0, 0, w, h)

  const paintMark = function (blur, alpha, fill) {
    ctx2d.save()
    ctx2d.translate(cx, cy)
    ctx2d.scale(scale, scale)
    ctx2d.beginPath()
    traceNeonHPath(ctx2d)
    ctx2d.shadowColor = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')'
    ctx2d.shadowBlur = blur / Math.max(scale, 1)
    if (fill) {
      ctx2d.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')'
      ctx2d.fill('nonzero')
    } else {
      ctx2d.strokeStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')'
      ctx2d.lineWidth = 0.035
      ctx2d.stroke()
    }
    ctx2d.restore()
  }

  // Outer bloom (additive-ish via layered draws)
  ctx2d.save()
  ctx2d.globalCompositeOperation = 'lighter'
  paintMark(glowBlur * 1.6, glowAlpha * 0.35, true)
  paintMark(glowBlur, glowAlpha * 0.55, true)
  ctx2d.restore()

  // Solid core
  paintMark(glowBlur * 0.35, coreAlpha, true)

  // Hot white-ish center edge for neon feel
  ctx2d.save()
  ctx2d.translate(cx, cy)
  ctx2d.scale(scale, scale)
  ctx2d.beginPath()
  traceNeonHPath(ctx2d)
  ctx2d.shadowColor = 'rgba(255,255,255,' + (0.35 * breath) + ')'
  ctx2d.shadowBlur = 6 / Math.max(scale, 1)
  ctx2d.fillStyle =
    'rgba(' +
    Math.min(255, rgb.r + 80) +
    ',' +
    Math.min(255, rgb.g + 80) +
    ',' +
    Math.min(255, rgb.b + 80) +
    ',' +
    (0.35 + 0.4 * breath) +
    ')'
  ctx2d.fill('nonzero')
  ctx2d.restore()

  if (busy) {
    ctx2d.save()
    ctx2d.strokeStyle =
      'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (0.4 + 0.4 * phase) + ')'
    ctx2d.lineWidth = 2
    ctx2d.beginPath()
    ctx2d.arc(cx, cy, scale * 1.35, t * 3, t * 3 + Math.PI * 1.25)
    ctx2d.stroke()
    ctx2d.restore()
  }
}

function NeonCanvas(props) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const startRef = useRef(0)
  // Latest values for rAF — avoid restarting loop on every prop change
  const latestRef = useRef({
    color: props.color,
    status: props.status,
    animMode: props.animMode,
    busy: props.busy,
    userScale: props.userScale == null ? 1 : props.userScale
  })

  useEffect(
    function () {
      latestRef.current = {
        color: props.color,
        status: props.status,
        animMode: props.animMode,
        busy: props.busy,
        userScale: props.userScale == null ? 1 : props.userScale
      }
    },
    [props.color, props.status, props.animMode, props.busy, props.userScale]
  )

  useEffect(function () {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return undefined

    const resize = function () {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cssW = Math.max(1, Math.floor(rect.width))
      const cssH = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(cssW * dpr)
      canvas.height = Math.floor(cssH * dpr)
      canvas.style.width = cssW + 'px'
      canvas.style.height = cssH + 'px'
      const c = canvas.getContext('2d')
      if (c) c.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    const ro = new ResizeObserver(function () {
      resize()
    })
    ro.observe(wrap)

    startRef.current = performance.now()
    const tick = function (now) {
      const c = canvas.getContext('2d')
      if (c) {
        const L = latestRef.current
        const tSec = (now - startRef.current) / 1000
        const pulse = pulseParams(L.status, L.animMode, L.busy)
        const cssW = canvas.clientWidth || 1
        const cssH = canvas.clientHeight || 1
        drawNeonH(c, cssW, cssH, {
          color: L.color,
          amp: pulse.amp,
          speed: pulse.speed,
          flash: pulse.flash,
          t: tSec,
          busy: L.busy,
          userScale: L.userScale
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return function () {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [])

  useEffect(
    function () {
      const wrap = wrapRef.current
      if (!wrap || typeof props.onAltWheel !== 'function') return undefined
      const onWheel = function (e) {
        if (!e.altKey) return
        e.preventDefault()
        e.stopPropagation()
        props.onAltWheel(e.deltaY)
      }
      wrap.addEventListener('wheel', onWheel, { passive: false })
      return function () {
        wrap.removeEventListener('wheel', onWheel)
      }
    },
    [props.onAltWheel]
  )

  const minClass = props.compact ? 'min-h-0' : 'min-h-[120px]'
  return jsx('div', {
    ref: wrapRef,
    className: cn('h-full w-full bg-black', minClass),
    title: props.wheelHint || undefined,
    children: jsx('canvas', {
      ref: canvasRef,
      className: 'block h-full w-full',
      'aria-label': 'Neon H provider health mark'
    })
  })
}

// ---------------------------------------------------------------------------
// Hooks — shared settings via atom
// ---------------------------------------------------------------------------

function useProviderStatuses(watched) {
  const key = (watched || []).slice().sort().join(',')
  return useQuery({
    queryKey: [ID, 'provider-status', key],
    queryFn: function () {
      return fetchAllStatuses(watched)
    },
    refetchInterval: POLL_MS,
    staleTime: POLL_MS / 2,
    retry: 1,
    refetchOnWindowFocus: true
  })
}

function usePluginSettings() {
  const settings = useValue($settings)

  const update = useCallback(function (patch) {
    const prev = $settings.get ? $settings.get() : settings
    const base = prev || loadSettings()
    const next = Object.assign({}, base, patch)
    if (patch.colors) {
      next.colors = Object.assign({}, base.colors, patch.colors)
      savePartial(STORAGE_KEYS.colors, next.colors)
    }
    if (patch.animMode != null) savePartial(STORAGE_KEYS.animMode, next.animMode)
    if (patch.watched) savePartial(STORAGE_KEYS.watched, next.watched)
    if (patch.panePlacement != null) savePartial(STORAGE_KEYS.panePlacement, next.panePlacement)
    if (patch.scale != null) {
      next.scale = clampScale(patch.scale)
      savePartial(STORAGE_KEYS.scale, next.scale)
    }
    $settings.set(next)
  }, [settings])

  const resetColors = useCallback(function () {
    const colors = Object.assign({}, DEFAULT_COLORS)
    savePartial(STORAGE_KEYS.colors, colors)
    const prev = $settings.get ? $settings.get() : settings
    $settings.set(Object.assign({}, prev || loadSettings(), { colors: colors }))
  }, [settings])

  return { settings: settings || loadSettings(), update: update, resetColors: resetColors }
}

// ---------------------------------------------------------------------------
// Safe UI helpers (feature-detect optional SDK widgets)
// ---------------------------------------------------------------------------

function SafeBadge(props) {
  if (typeof Badge === 'function') {
    return jsx(Badge, {
      variant: props.variant || 'secondary',
      className: props.className,
      children: props.children
    })
  }
  return jsx('span', {
    className: cn(
      'inline-flex items-center rounded px-1.5 py-0.5 text-[0.6rem]',
      'border border-(--ui-stroke-secondary) text-(--ui-text-tertiary)',
      props.className
    ),
    children: props.children
  })
}

function SafeScroll(props) {
  if (typeof ScrollArea === 'function') {
    return jsx(ScrollArea, { className: props.className, children: props.children })
  }
  return jsx('div', {
    className: cn('overflow-auto', props.className),
    children: props.children
  })
}

function SafeSeparator() {
  if (typeof Separator === 'function') return jsx(Separator, {})
  return jsx('hr', { className: 'border-(--ui-stroke-secondary)' })
}

function SafeTip(props) {
  if (typeof Tip === 'function') {
    try {
      return jsx(Tip, { label: props.label, children: props.children })
    } catch (_e) {
      // fall through
    }
  }
  return jsx('span', { title: props.label, children: props.children })
}

function SafeSwitch(props) {
  if (typeof Switch === 'function') {
    return jsx(Switch, {
      checked: props.checked,
      onCheckedChange: props.onCheckedChange
    })
  }
  return jsx('input', {
    type: 'checkbox',
    checked: !!props.checked,
    onChange: function (e) {
      if (props.onCheckedChange) props.onCheckedChange(e.target.checked)
    }
  })
}

// ---------------------------------------------------------------------------
// Mark pane
// ---------------------------------------------------------------------------

function MarkPane() {
  const model = useValue(host.state.model)
  const profile = useValue(host.state.profile)
  const busy = useValue(host.state.busy)
  const hook = usePluginSettings()
  const settings = hook.settings
  const update = hook.update
  const query = useProviderStatuses(settings.watched)
  const floating = settings.panePlacement === 'floating'
  const [scaleFlash, setScaleFlash] = useState(null)
  const flashTimer = useRef(0)

  const activeId = useMemo(
    function () {
      return parseProviderHint(model, profile) || settings.watched[0] || 'xai'
    },
    [model, profile, settings.watched]
  )

  const row = query.data && query.data[activeId]
  let activeStatus = 'unknown'
  if (query.isLoading && !query.data) activeStatus = 'loading'
  else if (row && row.status) activeStatus = row.status
  else if (query.isError) activeStatus = 'unknown'

  const color = statusColor(activeStatus, activeId, settings.colors)
  const label = (PROVIDER_DEFS[activeId] && PROVIDER_DEFS[activeId].label) || activeId
  const errBit =
    row && row.error && row.description ? ' · ' + row.description : query.isError ? ' · error' : ''
  const subtitle = label + ' · ' + activeStatus + (busy ? ' · busy' : '') + errBit
  const scale = clampScale(settings.scale == null ? DEFAULT_SCALE : settings.scale)
  // Floating pane chrome size is fixed at register (FLOAT_BASE*scale). Live
  // Alt+wheel updates storage + a CSS transform relative to the mount scale;
  // reload applies the new width/height. Docked panes use canvas userScale.
  const mountScaleRef = useRef(scale)

  const onAltWheel = useCallback(
    function (deltaY) {
      const step = deltaY > 0 ? -0.05 : 0.05
      const next = clampScale(scale + step)
      if (next === scale) return
      update({ scale: next })
      setScaleFlash(Math.round(next * 100) + '%')
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(function () {
        setScaleFlash(null)
      }, 900)
      if (typeof haptic === 'function') haptic('tap')
    },
    [scale, update]
  )

  useEffect(function () {
    return function () {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  const canvas = jsx(NeonCanvas, {
    color: color,
    status: activeStatus,
    animMode: settings.animMode,
    busy: !!busy,
    userScale: floating ? 1 : scale,
    compact: floating,
    wheelHint: 'Alt+scroll to scale (persisted; reload applies floating pane size)',
    onAltWheel: onAltWheel
  })

  if (floating) {
    const liveScale = scale / Math.max(0.01, mountScaleRef.current)
    // Sprite-first: Hermes title bar ("Neon H") is the drag handle — hide
    // subtitle / badge chrome so the floating card is mostly canvas.
    return jsxs('div', {
      className: 'relative flex h-full w-full flex-col overflow-hidden bg-black',
      title: subtitle,
      children: [
        jsx('div', {
          className: 'min-h-0 flex-1 origin-center',
          style: liveScale === 1 ? undefined : { transform: 'scale(' + liveScale + ')' },
          children: canvas
        }),
        scaleFlash
          ? jsx('div', {
              className:
                'pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/70 px-1.5 py-0.5 text-[0.6rem] text-white',
              children: scaleFlash
            })
          : null
      ]
    })
  }

  return jsxs('div', {
    className: 'flex h-full flex-col bg-black',
    children: [
      jsxs('div', {
        className:
          'flex items-center justify-between gap-2 border-b border-(--ui-stroke-secondary) px-2 py-1 text-[0.65rem] text-(--ui-text-tertiary)',
        children: [
          jsx('span', { className: 'truncate', title: subtitle, children: subtitle }),
          jsx(SafeBadge, {
            variant: 'secondary',
            className: 'shrink-0 text-[0.6rem]',
            children: settings.animMode
          })
        ]
      }),
      jsx('div', { className: 'min-h-0 flex-1', children: canvas })
    ]
  })
}

// ---------------------------------------------------------------------------
// Settings pane
// ---------------------------------------------------------------------------

function SettingsPane() {
  const hook = usePluginSettings()
  const settings = hook.settings
  const update = hook.update
  const resetColors = hook.resetColors

  const colorKeys = ['openai', 'anthropic', 'google', 'xai', 'warn', 'major']
  const colorFields = colorKeys.map(function (key) {
    return jsxs('div', {
      key: key,
      className: 'flex items-center gap-2',
      children: [
        jsx('div', {
          className: 'h-3 w-3 shrink-0 rounded-full border border-(--ui-stroke-secondary)',
          style: { backgroundColor: settings.colors[key] || DEFAULT_COLORS[key] }
        }),
        jsx('label', {
          className: 'w-20 shrink-0 text-xs text-(--ui-text-secondary)',
          children: key
        }),
        typeof Input === 'function'
          ? jsx(Input, {
              className: 'h-7 font-mono text-xs',
              value: settings.colors[key] || '',
              placeholder: DEFAULT_COLORS[key],
              onChange: function (e) {
                const patch = {}
                patch[key] = e.target.value
                update({ colors: patch })
              }
            })
          : jsx('input', {
              className:
                'h-7 w-full rounded-md border border-(--ui-stroke-secondary) bg-transparent px-2 font-mono text-xs',
              value: settings.colors[key] || '',
              placeholder: DEFAULT_COLORS[key],
              onChange: function (e) {
                const patch = {}
                patch[key] = e.target.value
                update({ colors: patch })
              }
            })
      ]
    })
  })

  const watchToggles = DEFAULT_WATCHED.map(function (id) {
    const on = settings.watched.indexOf(id) !== -1
    return jsxs('div', {
      key: id,
      className: 'flex items-center justify-between gap-2 py-1',
      children: [
        jsx('span', {
          className: 'text-xs text-(--ui-text-secondary)',
          children: PROVIDER_DEFS[id].label
        }),
        jsx(SafeSwitch, {
          checked: on,
          onCheckedChange: function (checked) {
            let next
            if (checked) {
              next = Array.from(new Set(settings.watched.concat([id])))
            } else {
              next = settings.watched.filter(function (x) {
                return x !== id
              })
            }
            update({ watched: next.length ? next : [id] })
          }
        })
      ]
    })
  })

  const placementButtons = PANE_PLACEMENTS.map(function (p) {
    const btnProps = {
      key: p,
      size: 'sm',
      variant: settings.panePlacement === p ? 'default' : 'outline',
      onClick: function () {
        update({ panePlacement: p })
        if (host.notify) {
          host.notify({
            kind: 'info',
            message:
              'Placement saved as ' + p +
              '. ⌘K → Reload desktop plugins to apply. Floating: drag by the pane header.'
          })
        }
      },
      children: p
    }
    if (typeof Button === 'function') return jsx(Button, btnProps)
    return jsx('button', {
      key: p,
      type: 'button',
      className: 'rounded-md border border-(--ui-stroke-secondary) px-2 py-1 text-xs',
      onClick: btnProps.onClick,
      children: p
    })
  })

  // Prefer plain <select> — don't rely on SegmentedControl API
  const animControl = jsx('select', {
    className: 'rounded-md border border-(--ui-stroke-secondary) bg-transparent px-2 py-1 text-xs',
    value: settings.animMode,
    title: 'Animation mode',
    onChange: function (e) {
      update({ animMode: e.target.value })
    },
    children: ANIM_MODES.map(function (m) {
      return jsx('option', { value: m.value, children: m.label, key: m.value })
    })
  })

  const modeButtons = ANIM_MODES.map(function (m) {
    const active = settings.animMode === m.value
    if (typeof Button === 'function') {
      return jsx(Button, {
        key: m.value,
        size: 'sm',
        variant: active ? 'default' : 'outline',
        title: m.label,
        onClick: function () {
          update({ animMode: m.value })
        },
        children: m.label
      })
    }
    return jsx('button', {
      key: m.value,
      type: 'button',
      title: m.label,
      className: cn(
        'rounded-md border px-2 py-1 text-xs',
        active ? 'border-(--ui-stroke-primary)' : 'border-(--ui-stroke-secondary)'
      ),
      onClick: function () {
        update({ animMode: m.value })
      },
      children: m.label
    })
  })

  return jsx(SafeScroll, {
    className: 'h-full',
    children: jsxs('div', {
      className: 'flex flex-col gap-4 p-3 text-sm',
      children: [
        jsxs('div', {
          children: [
            jsx('div', {
              className: 'font-medium text-(--ui-text-primary)',
              children: 'Neon H settings'
            }),
            jsx('p', {
              className: 'mt-1 text-xs text-(--ui-text-tertiary)',
              children:
                'Provider-tinted procedural neon H. Canvas colors are intentional product accents; chrome uses theme vars.'
            })
          ]
        }),
        jsx(SafeSeparator, {}),
        jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsx('div', {
              className: 'text-xs font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
              children: 'Animation'
            }),
            animControl,
            jsxs('div', { className: 'flex flex-wrap gap-1', children: modeButtons })
          ]
        }),
        jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsx('div', {
              className: 'text-xs font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
              children: 'Placement'
            }),
            jsx('p', {
              className: 'text-[0.65rem] text-(--ui-text-quaternary)',
              children:
                'Default is floating (small in-window widget). Drag by the Hermes pane header. Edge docks are optional. Placement changes need ⌘K → Reload desktop plugins.'
            }),
            jsxs('div', { className: 'flex flex-wrap gap-2', children: placementButtons })
          ]
        }),
        jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsx('div', {
              className: 'text-xs font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
              children: 'Scale'
            }),
            jsx('p', {
              className: 'text-[0.65rem] text-(--ui-text-quaternary)',
              children:
                'Alt+scroll over the mark also scales (' +
                String(SCALE_MIN) +
                '–' +
                String(SCALE_MAX) +
                '). Floating pane pixel size applies on reload; live preview uses a transform.'
            }),
            jsxs('div', {
              className: 'flex items-center gap-2',
              children: [
                jsx('input', {
                  type: 'range',
                  min: String(SCALE_MIN),
                  max: String(SCALE_MAX),
                  step: '0.05',
                  value: String(clampScale(settings.scale == null ? DEFAULT_SCALE : settings.scale)),
                  className: 'w-full',
                  onChange: function (e) {
                    update({ scale: clampScale(e.target.value) })
                  }
                }),
                jsx('span', {
                  className: 'w-10 shrink-0 text-right font-mono text-xs text-(--ui-text-secondary)',
                  children:
                    Math.round(
                      clampScale(settings.scale == null ? DEFAULT_SCALE : settings.scale) * 100
                    ) + '%'
                })
              ]
            })
          ]
        }),
        jsx(SafeSeparator, {}),
        jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsx('div', {
              className: 'text-xs font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
              children: 'Watched providers'
            }),
            jsx('div', { children: watchToggles })
          ]
        }),
        jsx(SafeSeparator, {}),
        jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsxs('div', {
              className: 'flex items-center justify-between',
              children: [
                jsx('div', {
                  className:
                    'text-xs font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
                  children: 'Colors (hex)'
                }),
                typeof Button === 'function'
                  ? jsx(Button, {
                      size: 'sm',
                      variant: 'ghost',
                      onClick: function () {
                        resetColors()
                        if (typeof haptic === 'function') haptic('tap')
                      },
                      children: 'Reset'
                    })
                  : jsx('button', {
                      type: 'button',
                      className: 'text-xs underline',
                      onClick: function () {
                        resetColors()
                      },
                      children: 'Reset'
                    })
              ]
            }),
            jsx('div', { className: 'flex flex-col gap-2', children: colorFields })
          ]
        }),
        jsx(SafeSeparator, {}),
        jsx('p', {
          className: 'text-[0.65rem] text-(--ui-text-quaternary)',
          children:
            'Google uses GCP incidents.json (open = missing/future end). xAI may report unknown if CORS/HTML sniff fails. Poll every ~50s. Floating stays inside the Hermes window — OS always-on-top pop-out is not available to disk plugins.'
        })
      ]
    })
  })
}

// ---------------------------------------------------------------------------
// Status bar chips
// ---------------------------------------------------------------------------

function ProviderChip(props) {
  const providerId = props.providerId
  const model = useValue(host.state.model)
  const profile = useValue(host.state.profile)
  const hook = usePluginSettings()
  const settings = hook.settings
  const query = useProviderStatuses(settings.watched)

  if (settings.watched.indexOf(providerId) === -1) return null

  const def = PROVIDER_DEFS[providerId]
  const row = query.data && query.data[providerId]
  let status = 'unknown'
  if (query.isLoading && !row) status = 'loading'
  else if (row && row.status) status = row.status

  const active = parseProviderHint(model, profile) === providerId
  const color = statusColor(status, providerId, settings.colors)
  const errText = row && row.error && row.description ? row.description : query.isError ? 'error' : ''
  const tip =
    def.label +
    ': ' +
    status +
    (row && row.description ? ' — ' + row.description : errText ? ' — ' + errText : '')

  const statusLabel =
    status === 'loading' ? '…' : status === 'operational' ? 'ok' : status === 'degraded' ? 'deg' : status === 'major' ? 'out' : '?'

  const dot = jsx('span', {
    className: 'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
    style: {
      backgroundColor: color,
      boxShadow: status === 'loading' ? 'none' : '0 0 4px ' + color,
      opacity: status === 'loading' ? 0.45 : 1
    },
    title: status
  })

  return jsx(SafeTip, {
    label: tip,
    children: jsxs('button', {
      type: 'button',
      title: tip,
      className: cn(
        'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] transition-colors',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
        active ? 'text-foreground' : ''
      ),
      onClick: function () {
        if (typeof haptic === 'function') haptic('tap')
        openNeonH()
      },
      children: [
        dot,
        jsx('span', {
          style: active ? { color: color } : undefined,
          children: def.short
        }),
        jsx('span', {
          className: 'text-[0.55rem] uppercase opacity-70',
          style: { color: color },
          children: statusLabel
        })
      ]
    })
  })
}

// ---------------------------------------------------------------------------
// Open helpers. Registered panes are the durable dock/floating surface; these
// workspace tiles remain a feature-detected, closeable quick-preview path.
// ---------------------------------------------------------------------------

const workspaceClosers = {}

function closeWorkspacePreview(id) {
  const close = workspaceClosers[id]
  delete workspaceClosers[id]
  if (typeof close === 'function') {
    try {
      close()
    } catch (_e) {
      // A user may have closed it already; cleanup is intentionally best-effort.
    }
  }
}

function openNeonH() {
  if (typeof host.openWorkspace === 'function') {
    try {
      closeWorkspacePreview('mark')
      workspaceClosers.mark = host.openWorkspace('hermes-neon-h:mark', {
        title: 'Neon H',
        minWidth: '280px',
        onClose: function () {
          delete workspaceClosers.mark
        },
        render: function () {
          return jsx(MarkPane, {})
        }
      })
      return
    } catch (_e) {
      // fall through
    }
  }
  if (host.notify) {
    host.notify({
      kind: 'info',
      message:
        'Neon H pane is registered — open it from the layout / pane tabs (workspace API unavailable).'
    })
  }
}

function openNeonSettings() {
  if (typeof host.openWorkspace === 'function') {
    try {
      closeWorkspacePreview('settings')
      workspaceClosers.settings = host.openWorkspace('hermes-neon-h:settings', {
        title: 'Neon H settings',
        minWidth: '320px',
        onClose: function () {
          delete workspaceClosers.settings
        },
        render: function () {
          return jsx(SettingsPane, {})
        }
      })
      return
    } catch (_e) {}
  }
  if (host.notify) {
    host.notify({
      kind: 'info',
      message: 'Neon H settings pane is registered — open it from the layout / pane tabs.'
    })
  }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export default {
  id: ID,
  name: 'Neon H',
  defaultEnabled: false,
  register: function (ctx) {
    _storage = ctx.storage
    const initial = loadSettings()
    $settings.set(initial)

    const paneData = paneDataFor(initial.panePlacement, initial.scale)
    // `openWorkspace` tiles do not belong to ctx.register, so retire them on
    // hot reload, disable, and removal instead of leaking stale views.
    ctx.onDispose(function () {
      closeWorkspacePreview('mark')
      closeWorkspacePreview('settings')
      _storage = null
    })

    ctx.register({
      id: 'mark',
      area: PANES_AREA,
      // Short title doubles as the Hermes floating-pane drag header.
      title: 'Neon H',
      data: paneData,
      render: function () {
        return jsx(MarkPane, {})
      }
    })

    // Settings as a second floating pane (not a large docked workspace by default).
    ctx.register({
      id: 'settings',
      area: PANES_AREA,
      title: 'Neon H settings',
      data: {
        placement: 'floating',
        anchor: 'bottom-left',
        width: '320px',
        height: '440px'
      },
      render: function () {
        return jsx(SettingsPane, {})
      }
    })

    const chipOrder = { openai: 140, anthropic: 141, google: 142, xai: 143 }
    for (let i = 0; i < DEFAULT_WATCHED.length; i++) {
      const id = DEFAULT_WATCHED[i]
      ctx.register({
        id: 'chip-' + id,
        area: STATUSBAR_AREAS.right,
        order: chipOrder[id] || 140,
        render: function () {
          return jsx(ProviderChip, { providerId: id })
        }
      })
    }

    ctx.register({
      id: 'palette-open',
      area: PALETTE_AREA,
      data: {
        id: 'hermes-neon-h.open',
        label: 'Open Neon H',
        keywords: ['neon', 'hermes', 'provider', 'status', 'logo'],
        run: function () {
          openNeonH()
        }
      }
    })

    ctx.register({
      id: 'palette-settings',
      area: PALETTE_AREA,
      data: {
        id: 'hermes-neon-h.settings',
        label: 'Open Neon H settings',
        keywords: ['neon', 'settings', 'colors', 'animation'],
        run: function () {
          openNeonSettings()
        }
      }
    })
  }
}
