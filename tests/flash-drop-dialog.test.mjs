import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/components/flashdrops/CreateFlashDropSheet.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/components/flashdrops/fan-gifts-ticket.css', import.meta.url), 'utf8');
const output = await transform(source.replace(/^import .+\n/gm, ''), {
  loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment',
});
const h = (type, props, ...children) => ({ type, props: { ...props, children } });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
  : value == null || value === false ? [] : [value, ...nodes(value.props?.children)];
const text = value => nodes(value).filter(node => typeof node === 'string').join(' ');

// Execute the actual component and callbacks with isolated hook/API fixtures.
// Radix primitives are structural markers here; browser focus trapping and
// rendered layout require a separate UI check, not this Node fixture.
function fixture() {
  const state = [], refs = [];
  const effects = [];
  let stateCursor = 0, refCursor = 0, closeCount = 0, remoteCalls = 0;
  const focus = [];
  const trigger = { isConnected: true, focus: options => focus.push({ target: 'trigger', options }) };
  const document = { activeElement: trigger };
  const module = { exports: {} };
  const forbidden = () => { remoteCalls++; throw new Error('No API calls expected for dialog navigation'); };
  vm.runInNewContext(output.code, {
    module, exports: module.exports, h, Fragment: 'fragment', document,
    Dialog: Object.fromEntries(['Root', 'Portal', 'Overlay', 'Content', 'Close', 'Title', 'Description'].map(key => [key, `dialog-${key}`])),
    motion: { div: 'div' }, X: 'icon', Zap: 'icon', Clock: 'icon',
    useId: () => 'fixture-gift',
    useState: initial => {
      const index = stateCursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef: initial => {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect: effect => effects.push(effect),
    base44: {
      entities: { Listing: { filter: forbidden } },
      functions: { invoke: forbidden }, integrations: { Core: { UploadFile: forbidden } },
    },
  });
  const Sheet = module.exports.default;
  let tree;
  const find = (type, predicate = () => true) => nodes(tree).find(node => node?.type === type && predicate(node));
  const render = () => {
    stateCursor = 0; refCursor = 0; effects.length = 0;
    tree = Sheet({ event: { id: 'event-fixture', title: 'Fixture event' }, user: { email: 'fan@example.test' }, onClose: () => closeCount++ });
    find('dialog-Close').props.ref.current = { focus: options => focus.push({ target: 'close', options }) };
    find('dialog-Title').props.ref.current = { focus: options => focus.push({ target: 'heading', options }) };
    find('dialog-Content').props.ref.current = { scrollTo: options => focus.push({ target: 'scroll', options }) };
    effects.forEach(effect => effect());
    return tree;
  };
  const button = label => find('button', node => text(node).trim() === label);
  render();
  return { render, find, button, focus, trigger, get tree() { return tree; }, get closes() { return closeCount; }, get calls() { return remoteCalls; } };
}

test('Flash Drop uses one named modal in a portal and restores its captured opener', () => {
  const app = fixture();
  assert.equal(app.tree.type, 'dialog-Root');
  assert.equal(app.tree.props.open, true);
  const portal = app.find('dialog-Portal');
  assert.ok(nodes(portal).includes(app.find('dialog-Overlay')));
  assert.ok(nodes(portal).includes(app.find('dialog-Content')));
  assert.match(text(app.find('dialog-Title')), /Create Flash Drop.*Choose drop type/);
  assert.equal(text(app.find('dialog-Description')), 'Fixture event');
  assert.equal(app.find('dialog-Close').props['aria-label'], 'Close fan gift form');
  const content = app.find('dialog-Content');
  let prevented = 0;
  content.props.onOpenAutoFocus({ preventDefault() { prevented++; } });
  assert.equal(app.focus.at(-1).target, 'close');
  content.props.onCloseAutoFocus({ preventDefault() { prevented++; } });
  assert.equal(app.focus.at(-1).target, 'trigger');
  assert.equal(app.focus.at(-1).options.preventScroll, true);
  app.trigger.isConnected = false;
  const count = app.focus.length;
  content.props.onCloseAutoFocus({ preventDefault() { prevented++; } });
  assert.equal(app.focus.length, count, 'do not focus a removed opener');
  assert.equal(prevented, 3);
  app.tree.props.onOpenChange(true);
  assert.equal(app.closes, 0);
  app.tree.props.onOpenChange(false);
  assert.equal(app.closes, 1, 'Radix dismissal delegates to the existing close callback');
  assert.equal(app.calls, 0);
});

test('details fields have labels and anonymous/upload controls stay keyboard reachable', () => {
  const app = fixture();
  app.find('button', node => text(node).includes('Immediate Drop')).props.onClick();
  app.render();
  assert.match(text(app.find('dialog-Title')), /Seat details/);
  assert.equal(app.focus.at(-1).target, 'heading');
  assert.equal(app.focus.at(-2).target, 'scroll');
  for (const name of ['section', 'row', 'seats', 'quantity', 'message']) {
    const id = `fixture-gift-${name}`;
    assert.ok(app.find('label', node => node.props.htmlFor === id));
    assert.ok(app.find('input', node => node.props.id === id));
  }
  assert.equal(app.find('input', node => node.props.id === 'fixture-gift-section').props['aria-required'], 'true');
  assert.equal(app.button('Drop Now').props.disabled, true);
  const checkbox = app.find('input', node => node.props.type === 'checkbox');
  assert.equal(checkbox.props.checked, false);
  checkbox.props.onChange({ target: { checked: true } });
  app.render();
  assert.equal(app.find('input', node => node.props.type === 'checkbox').props.checked, true);
  const file = app.find('input', node => node.props.type === 'file');
  assert.equal(file.props.className, 'sr-only');
  assert.ok(app.find('label', node => nodes(node).includes(file)));
  assert.equal(app.button('60 seconds').props['aria-pressed'], true);
  app.button('30 seconds').props.onClick();
  app.render();
  assert.equal(app.button('30 seconds').props['aria-pressed'], true);
  assert.equal(app.button('60 seconds').props['aria-pressed'], false);
  assert.equal(app.calls, 0);
});

test('scheduled navigation retains its required fields and resets focus for each step without creating a gift', () => {
  const app = fixture();
  app.find('button', node => text(node).includes('Scheduled Drop')).props.onClick();
  app.render();
  assert.equal(app.button('Next: Schedule').props.disabled, true);
  app.find('input', node => node.props.id === 'fixture-gift-section').props.onChange({ target: { value: '101' } });
  app.render();
  assert.equal(app.button('Next: Schedule').props.disabled, false);
  app.button('Next: Schedule').props.onClick();
  app.render();
  assert.match(text(app.find('dialog-Title')), /Schedule/);
  assert.equal(app.button('Schedule Drop').props.disabled, true);
  app.button('Halftime').props.onClick();
  app.render();
  assert.equal(app.button('Halftime').props['aria-pressed'], true);
  assert.equal(app.button('Schedule Drop').props.disabled, false);
  app.button('Back').props.onClick();
  app.render();
  app.button('Back').props.onClick();
  app.render();
  assert.match(text(app.find('dialog-Title')), /Choose drop type/);
  assert.equal(app.focus.at(-1).target, 'heading');
  assert.equal(app.calls, 0);
});

test('portaled sheet stacking and scroll bounds explicitly clear navigation and preserve safe areas', () => {
  const rule = selector => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)) + 1);
  const backdrop = rule('.pg-gift-sheet-backdrop');
  const sheet = rule('.pg-gift-sheet');
  assert.match(backdrop, /position: fixed/);
  assert.match(backdrop, /z-index: 150/);
  assert.match(sheet, /position: fixed; z-index: 151/);
  assert.match(sheet, /100dvh.*safe-area-inset-top/);
  assert.match(sheet, /overflow-y: auto; overscroll-behavior: contain/);
  assert.match(sheet, /padding-bottom:.*safe-area-inset-bottom/);
  assert.match(css, /\.pg-gift-upload:focus-within/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
