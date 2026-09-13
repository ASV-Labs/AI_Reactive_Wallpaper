import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const file = new URL('./plugin.js', import.meta.url)
let source = fs.readFileSync(file, 'utf8')

// Execute registration only. Plugin render functions are retained but never
// invoked, so a tiny SDK host is enough to validate the runtime-facing shape.
source = source
  .replace(/import\s*\{[\s\S]*?\}\s*from '@hermes\/plugin-sdk'\n/, '')
  .replace(/import\s*\{[\s\S]*?\}\s*from 'react'\n/, '')
  .replace(/import\s*\{[\s\S]*?\}\s*from 'react\/jsx-runtime'\n/, '')
  .replace('export default {', 'globalThis.__plugin = {')

const openCalls = []
const host = {
  notify() {},
  openWorkspace(id, options) {
    const call = { id, options, closed: false }
    openCalls.push(call)
    return () => {
      call.closed = true
      options.onClose?.()
    }
  },
  state: {}
}
const context = {
  globalThis: {},
  host,
  // Render-only imports; harmless placeholders while registration is tested.
  haptic() {}, Tip: null, cn: (...xs) => xs.filter(Boolean).join(' '),
  atom(initial) { let value = initial; return { get: () => value, set: next => { value = next }, subscribe: () => () => {} } },
  useValue(value) { return value.get() }, useQuery() {}, Button: null, Input: null, Switch: null, SegmentedControl: null,
  StatusDot: null, ScrollArea: null, Separator: null, Badge: null,
  PALETTE_AREA: 'palette', STATUSBAR_AREAS: { right: 'status.right' }, PANES_AREA: 'panes',
  useEffect() {}, useRef(v) { return { current: v } }, useState(v) { return [typeof v === 'function' ? v() : v, () => {}] },
  useCallback(fn) { return fn }, useMemo(fn) { return fn() },
  jsx() {}, jsxs() {}, console
}
context.globalThis = context
vm.runInNewContext(source, context, { filename: file.pathname })
const plugin = context.__plugin
assert.equal(plugin.id, 'hermes-neon-h')
assert.equal(plugin.defaultEnabled, false)

function registerWith(storageMap) {
  const registered = []
  const disposers = []
  plugin.register({
    storage: {
      get(key, fallback) {
        return Object.prototype.hasOwnProperty.call(storageMap, key) ? storageMap[key] : fallback
      },
      set() {}
    },
    register(contribution) { registered.push(contribution); return () => {} },
    onDispose(fn) { disposers.push(fn) }
  })
  return { registered, disposers }
}

// Default (no stored placement) must be floating ~160px at scale 1.
{
  const { registered, disposers } = registerWith({})
  const mark = registered.find(item => item.id === 'mark')
  assert.ok(mark, 'default: mark pane is registered')
  assert.equal(mark.data.placement, 'floating')
  assert.equal(mark.data.anchor, 'bottom-right')
  assert.equal(mark.data.width, '160px')
  assert.equal(mark.data.height, '160px')
  assert.equal(mark.title, '', 'mark title blank so Hermes header shows empty, not pane id')
  const settingsPane = registered.find(item => item.id === 'settings')
  assert.equal(settingsPane.title, 'Neon H settings')
  assert.equal(settingsPane.data.placement, 'floating')
  assert.equal(disposers.length, 1)
}

// Source must ship the mark-float chrome CSS injector (Hermes has no frameless flag).
{
  const src = fs.readFileSync(file, 'utf8')
  assert.match(src, /ensureMarkFloatChromeCss/)
  assert.match(src, /MARK_FLOAT_PANE_ATTR = 'hermes-neon-h:mark'/)
  assert.match(src, /\[data-floating-pane="/)
  assert.match(src, /MARK_FLOAT_CSS_ID/)
  assert.match(src, /title: ''/)
  assert.doesNotMatch(src, /petdex/i)
}

// Scaled floating geometry
{
  const { registered } = registerWith({ panePlacement: 'floating', scale: 1.5 })
  const mark = registered.find(item => item.id === 'mark')
  assert.equal(mark.data.placement, 'floating')
  assert.equal(mark.data.width, '240px')
  assert.equal(mark.data.height, '240px')
}

for (const placement of ['bottom', 'top', 'left', 'right', 'floating', 'unexpected-value']) {
  const { registered, disposers } = registerWith({ panePlacement: placement })
  const mark = registered.find(item => item.id === 'mark')
  assert.ok(mark, `${placement}: mark pane is registered`)
  const expectedPlacement = ['floating', 'bottom', 'top', 'left', 'right'].includes(placement)
    ? placement
    : 'floating'
  if (expectedPlacement === 'floating') {
    assert.equal(mark.data.placement, 'floating')
    assert.equal(mark.data.anchor, 'bottom-right')
    assert.equal(mark.data.width, '160px')
    assert.equal(mark.data.height, '160px')
  } else {
    assert.equal(mark.data.placement, 'main')
    assert.equal(mark.data.dock.pane, 'workspace')
    assert.equal(mark.data.dock.pos, expectedPlacement)
    assert.equal(expectedPlacement === 'left' || expectedPlacement === 'right' ? mark.data.width : mark.data.height,
      expectedPlacement === 'left' || expectedPlacement === 'right' ? '260px' : '200px')
  }
  if (placement === 'unexpected-value') {
    assert.equal(mark.data.placement, 'floating', 'invalid placement normalizes to floating')
  }
  assert.equal(disposers.length, 1, `${placement}: unload cleanup is registered`)
}

const registered = []
const disposers = []
plugin.register({
  storage: { get(_key, fallback) { return fallback }, set() {} },
  register(contribution) { registered.push(contribution); return () => {} },
  onDispose(fn) { disposers.push(fn) }
})
registered.find(item => item.data?.id === 'hermes-neon-h.open').data.run()
registered.find(item => item.data?.id === 'hermes-neon-h.settings').data.run()
assert.deepEqual(openCalls.map(call => call.id), ['hermes-neon-h:mark', 'hermes-neon-h:settings'])
disposers.at(-1)()
assert.ok(openCalls.every(call => call.closed), 'unload closes workspace previews')


// v1.1.4: overflow-visible float wrap + harder inward DOM pulse + version chip
{
  const src = fs.readFileSync(file, 'utf8')
  assert.match(src, /PLUGIN_VERSION = '1\.1\.4'/)
  assert.match(src, /plugin ' \+ PLUGIN_VERSION/)
  assert.match(src, /0\.55 \+ 0\.55 \* b/)
  assert.match(src, /0\.4 \+ 0\.6 \* b/)
  assert.match(src, /0\.65 \+ 0\.7 \* b/)
  assert.match(src, /flex-col overflow-visible bg-transparent/)
  assert.match(src, /transformOrigin = 'center center'/)
  assert.match(src, /willChange = 'transform, opacity, filter'/)
  assert.match(src, /getContext\('2d', \{ alpha: false, willReadFrequently: true \}/)
  assert.match(src, /return breath/)
  assert.match(src, /function drawNeonH\(/)
  assert.match(src, /function MarkPane\(/)
  assert.match(src, /function NeonCanvas\(/)
}

console.log('hermes-neon-h regression: floating default, blank mark title, logo CSS, scale geometry, placements, preview cleanup, v1.1.4 overflow-visible pulse passed')
