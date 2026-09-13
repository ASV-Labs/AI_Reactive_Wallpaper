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
  useEffect() {}, useRef() {}, useState() {}, useCallback(fn) { return fn }, useMemo(fn) { return fn() },
  jsx() {}, jsxs() {}, console
}
context.globalThis = context
vm.runInNewContext(source, context, { filename: file.pathname })
const plugin = context.__plugin
assert.equal(plugin.id, 'hermes-neon-h')

for (const placement of ['bottom', 'top', 'left', 'right', 'floating', 'unexpected-value']) {
  const registered = []
  const disposers = []
  plugin.register({
    storage: { get(key, fallback) { return key === 'panePlacement' ? placement : fallback }, set() {} },
    register(contribution) { registered.push(contribution); return () => {} },
    onDispose(fn) { disposers.push(fn) }
  })
  const mark = registered.find(item => item.id === 'mark')
  assert.ok(mark, `${placement}: mark pane is registered`)
  const expectedPlacement = ['bottom', 'top', 'left', 'right', 'floating'].includes(placement)
    ? placement
    : 'bottom'
  if (expectedPlacement === 'floating') {
    assert.equal(mark.data.placement, 'floating')
    assert.equal(mark.data.anchor, 'bottom-right')
    assert.equal(mark.data.width, '180px')
    assert.equal(mark.data.height, '180px')
  } else {
    assert.equal(mark.data.placement, 'main')
    assert.equal(mark.data.dock.pane, 'workspace')
    assert.equal(mark.data.dock.pos, expectedPlacement)
    assert.equal(expectedPlacement === 'left' || expectedPlacement === 'right' ? mark.data.width : mark.data.height,
      expectedPlacement === 'left' || expectedPlacement === 'right' ? '260px' : '200px')
  }
  if (placement === 'unexpected-value') {
    assert.equal(mark.data.dock.pos, 'bottom', 'invalid placement normalizes to bottom')
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

console.log('hermes-neon-h regression: 5 placement modes, invalid normalization, and preview cleanup passed')
