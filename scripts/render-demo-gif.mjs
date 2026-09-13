#!/usr/bin/env node
/**
 * Offline demo: ~3s looping neon-H breathe → demo/neon-h-breathe.gif
 * Uses the same procedural geometry as plugin.js (duplicated for Node/canvas).
 * Optional: also writes demo/neon-h-breathe.webm if ffmpeg is available.
 *
 *   node scripts/render-demo-gif.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'demo')
const SIZE = 160
const FPS = 20
const DURATION = 3
const FRAMES = FPS * DURATION
const COLOR = '#ff6b2c' // xAI orange — readable on black
const AMP = 0.48
const SPEED = 1.0

const require = createRequire(import.meta.url)
let createCanvas
try {
  ;({ createCanvas } = require('canvas'))
} catch (err) {
  console.error('canvas package required to render. npm install canvas (dev) then re-run.')
  console.error(err.message)
  process.exit(1)
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  if (!Number.isFinite(n)) return { r: 255, g: 107, b: 44 }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function traceNeonHPath(ctx2d) {
  const o = 0.92
  const t = 0.14
  const gap = 0.22
  const i = o - t
  ctx2d.moveTo(-gap, -o)
  ctx2d.lineTo(-o, -o)
  ctx2d.lineTo(-o, o)
  ctx2d.lineTo(-gap, o)
  ctx2d.lineTo(-gap, i)
  ctx2d.lineTo(-i, i)
  ctx2d.lineTo(-i, -i)
  ctx2d.lineTo(-gap, -i)
  ctx2d.closePath()
  ctx2d.moveTo(gap, -o)
  ctx2d.lineTo(o, -o)
  ctx2d.lineTo(o, o)
  ctx2d.lineTo(gap, o)
  ctx2d.lineTo(gap, i)
  ctx2d.lineTo(i, i)
  ctx2d.lineTo(i, -i)
  ctx2d.lineTo(gap, -i)
  ctx2d.closePath()
  const ux = 0.42
  const uxIn = 0.18
  const uy = 0.58
  const bridgeHalfH = 0.1
  const bridgeHalfW = 0.18
  ctx2d.moveTo(-ux, -uy)
  ctx2d.lineTo(-uxIn, -uy)
  ctx2d.lineTo(-uxIn, -bridgeHalfH)
  ctx2d.lineTo(-ux, -bridgeHalfH)
  ctx2d.closePath()
  ctx2d.moveTo(-ux, bridgeHalfH)
  ctx2d.lineTo(-uxIn, bridgeHalfH)
  ctx2d.lineTo(-uxIn, uy)
  ctx2d.lineTo(-ux, uy)
  ctx2d.closePath()
  ctx2d.moveTo(ux, -uy)
  ctx2d.lineTo(uxIn, -uy)
  ctx2d.lineTo(uxIn, -bridgeHalfH)
  ctx2d.lineTo(ux, -bridgeHalfH)
  ctx2d.closePath()
  ctx2d.moveTo(ux, bridgeHalfH)
  ctx2d.lineTo(uxIn, bridgeHalfH)
  ctx2d.lineTo(uxIn, uy)
  ctx2d.lineTo(ux, uy)
  ctx2d.closePath()
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
  const t = opts.t
  const rgb = hexToRgb(color)
  const cx = w / 2
  const cy = h / 2
  const base = Math.min(w, h) * 0.38
  const phase = speed > 0 ? (Math.sin(t * speed * 2.2) + 1) / 2 : 0.5
  const breath = 1 - amp + amp * phase
  const scale = base * (0.72 + 0.38 * breath)
  const glowBlur = 10 + 48 * amp * breath
  const coreAlpha = 0.55 + 0.45 * breath
  const glowAlpha = 0.22 + 0.68 * breath

  ctx2d.clearRect(0, 0, w, h)
  ctx2d.fillStyle = '#000000'
  ctx2d.fillRect(0, 0, w, h)

  const glowR = scale * (1.35 + 0.55 * breath)
  const g = ctx2d.createRadialGradient(cx, cy, scale * 0.15, cx, cy, glowR)
  g.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.45 * breath})`)
  g.addColorStop(0.4, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.14 * breath})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx2d.fillStyle = g
  ctx2d.fillRect(0, 0, w, h)

  const paintMark = (blur, alpha, fill) => {
    ctx2d.save()
    ctx2d.translate(cx, cy)
    ctx2d.scale(scale, scale)
    ctx2d.beginPath()
    traceNeonHPath(ctx2d)
    ctx2d.shadowColor = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`
    ctx2d.shadowBlur = blur / Math.max(scale, 1)
    if (fill) {
      ctx2d.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`
      ctx2d.fill('nonzero')
    } else {
      ctx2d.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`
      ctx2d.lineWidth = 0.035
      ctx2d.stroke()
    }
    ctx2d.restore()
  }

  ctx2d.save()
  ctx2d.globalCompositeOperation = 'lighter'
  paintMark(glowBlur * 1.6, glowAlpha * 0.35, true)
  paintMark(glowBlur, glowAlpha * 0.55, true)
  ctx2d.restore()
  paintMark(glowBlur * 0.35, coreAlpha, true)

  ctx2d.save()
  ctx2d.translate(cx, cy)
  ctx2d.scale(scale, scale)
  ctx2d.beginPath()
  traceNeonHPath(ctx2d)
  ctx2d.shadowColor = `rgba(255,255,255,${0.35 * breath})`
  ctx2d.shadowBlur = 6 / Math.max(scale, 1)
  ctx2d.fillStyle = `rgba(${Math.min(255, rgb.r + 80)},${Math.min(255, rgb.g + 80)},${Math.min(255, rgb.b + 80)},${0.35 + 0.4 * breath})`
  ctx2d.fill('nonzero')
  ctx2d.restore()

  return breath
}

fs.mkdirSync(outDir, { recursive: true })
const frameDir = path.join(outDir, '.frames')
fs.rmSync(frameDir, { recursive: true, force: true })
fs.mkdirSync(frameDir, { recursive: true })

const canvas = createCanvas(SIZE, SIZE)
const ctx = canvas.getContext('2d')

for (let i = 0; i < FRAMES; i++) {
  const t = i / FPS
  drawNeonH(ctx, SIZE, SIZE, { color: COLOR, amp: AMP, speed: SPEED, t })
  const file = path.join(frameDir, `frame_${String(i).padStart(4, '0')}.png`)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
}

const gifPath = path.join(outDir, 'neon-h-breathe.gif')
const palette = path.join(frameDir, 'palette.png')

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.status}`)
}

run('ffmpeg', [
  '-y', '-framerate', String(FPS), '-i', path.join(frameDir, 'frame_%04d.png'),
  '-vf', 'palettegen=stats_mode=diff',
  '-frames:v', '1', '-update', '1', palette
])
run('ffmpeg', [
  '-y', '-framerate', String(FPS), '-i', path.join(frameDir, 'frame_%04d.png'),
  '-i', palette,
  '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3',
  '-loop', '0',
  gifPath
])

const webmPath = path.join(outDir, 'neon-h-breathe.webm')
try {
  run('ffmpeg', [
    '-y', '-framerate', String(FPS), '-i', path.join(frameDir, 'frame_%04d.png'),
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-an', webmPath
  ])
} catch (e) {
  console.warn('webm optional failed:', e.message)
}

fs.rmSync(frameDir, { recursive: true, force: true })
const gifStat = fs.statSync(gifPath)
console.log(`Wrote ${gifPath} (${(gifStat.size / 1024).toFixed(1)} KB)`)
if (fs.existsSync(webmPath)) {
  console.log(`Wrote ${webmPath} (${(fs.statSync(webmPath).size / 1024).toFixed(1)} KB)`)
}
