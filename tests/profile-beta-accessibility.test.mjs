import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import postcss from 'postcss';
import * as points from '../src/lib/peanutPoints.js';
import { pointTextColor } from '../src/lib/pointsPresentation.js';
import { helpQuerySummary } from '../src/lib/helpQuerySummary.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const h = (type, props, ...children) => ({ type, props: { ...props, children } });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value == null || value === false ? [] : [value, ...nodes(value.props?.children)];
const text = value => nodes(value).filter(node => typeof node === 'string' || typeof node === 'number').join(' ');

async function fixture(file, name = 'default', extra = {}, props = {}) {
  const source = read(file).replace(/^import[\s\S]*?;\n/gm, '');
  const output = await transform(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' });
  const state = [];
  let cursor = 0;
  const forbidden = () => { throw new Error('No SDK calls allowed in this component fixture'); };
  const module = { exports: {} };
  vm.runInNewContext(output.code, {
    module, exports: module.exports, h, Fragment: 'fragment',
    ...Object.fromEntries(['Trophy', 'Star', 'ChevronRight', 'Shield', 'Info', 'Send', 'ChevronDown', 'ChevronUp'].map(icon => [icon, `icon-${icon}`])),
    Link: 'link', motion: { div: 'div' }, ...points, pointTextColor,
    useId: () => 'fixture-control', useEffect: () => {}, useRef: value => ({ current: value }),
    useState: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    base44: new Proxy({}, { get: forbidden }), ...extra,
  });
  let tree;
  const render = nextProps => { cursor = 0; tree = module.exports[name](nextProps || props); return tree; };
  render();
  return { render, get tree() { return tree; }, find: (type, predicate = () => true) => nodes(tree).find(node => node?.type === type && predicate(node)) };
}

test('rank info has a stable named disclosure with expanded state and a reachable target', async () => {
  const app = await fixture('src/components/points/PeanutPointsCard.jsx', 'default', {}, { user: { lifetime_points: 0, trust_score: 50 } });
  const info = () => app.find('button', node => node.props['aria-controls']);
  assert.equal(info().props['aria-label'], 'About Crowd Member rank unlocks');
  assert.equal(info().props['aria-expanded'], false);
  assert.equal(app.find('div', node => node.props.id === info().props['aria-controls']).props.hidden, true);
  info().props.onClick(); app.render();
  assert.equal(info().props['aria-expanded'], true);
  const details = app.find('div', node => node.props.id === info().props['aria-controls']);
  assert.equal(details.props.hidden, false);
  assert.match(text(details), /Profile badge.*Leaderboard eligibility/);
  info().props.onClick(); app.render();
  assert.equal(info().props['aria-expanded'], false);
});

test('feedback uses one native radio group with five named values and a single selected value', async () => {
  let selected = 0;
  const app = await fixture('src/components/beta/BetaFeedbackForm.jsx', 'StarRating', {}, { value: selected, onChange: value => { selected = value; } });
  assert.equal(app.tree.type, 'fieldset');
  assert.equal(app.tree.props.role, 'radiogroup');
  assert.equal(app.tree.props['aria-labelledby'], app.find('legend').props.id);
  assert.equal(text(app.find('legend')), 'Overall rating');
  const radios = () => nodes(app.tree).filter(node => node?.type === 'input');
  assert.equal(radios().length, 5);
  assert.equal(new Set(radios().map(node => node.props.name)).size, 1);
  assert.deepEqual(radios().map(node => node.props.value), [1, 2, 3, 4, 5]);
  for (const [index, node] of radios().entries()) {
    assert.equal(node.props.type, 'radio');
    assert.equal(node.props['aria-label'], `${index + 1} ${index ? 'stars' : 'star'} out of 5`);
    assert.equal(node.props.tabIndex, undefined, 'native radio arrow/Tab behavior must not be overridden');
  }
  for (let value = 1; value <= 5; value++) {
    radios()[value - 1].props.onChange();
    app.render({ value: selected, onChange: next => { selected = next; } });
    assert.deepEqual(radios().filter(node => node.props.checked).map(node => node.props.value), [value]);
    assert.equal(text(app.find('p')), `${value} of 5 stars selected`);
  }
});

test('all feedback questions and identity fields have associated labels without placeholders', async () => {
  const app = await fixture('src/components/beta/BetaFeedbackForm.jsx');
  const fields = nodes(app.tree).filter(node => ['input', 'textarea'].includes(node?.type));
  assert.equal(fields.length, 7);
  for (const field of fields) {
    assert.ok(field.props.id);
    assert.ok(text(app.find('label', node => node.props.htmlFor === field.props.id)).trim());
  }
  assert.equal(app.find('input', node => node.props.id.endsWith('-name')).props.required, true);
});

test('seller-history count shows loading/unavailable rather than an unverified zero', async () => {
  const app = await fixture('src/components/points/PeanutPointsCard.jsx', 'default', {}, { user: {} });
  assert.match(text(app.tree), /….*Completed sales/);
  app.render({ user: {}, sellerSummary: { status: 'ready', summary: { completedCount: 7 } } });
  assert.match(text(app.tree), /7.*Completed sales/);
  let retries = 0;
  app.render({ user: {}, sellerSummary: { status: 'error', reload: () => { retries++; } } });
  assert.match(text(app.tree), /Unavailable.*Completed sales/);
  app.find('button', node => text(node) === 'Retry sales').props.onClick();
  assert.equal(retries, 1);
});

const cssTokens = (file, selectors) => {
  const values = {};
  postcss.parse(read(file)).walkRules(rule => {
    if (rule.selectors.some(selector => selectors.includes(selector))) rule.walkDecls(/^--/, declaration => { values[declaration.prop] = declaration.value; });
  });
  return values;
};
const rgb = hex => hex.slice(1).match(/../g).slice(0, 3).map(channel => parseInt(channel, 16));
const blend = (foreground, background, alpha) => foreground.map((value, index) => alpha * value + (1 - alpha) * background[index]);
const luminance = value => value.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

for (const dark of [false, true]) {
  const theme = dark ? 'dark' : 'light';
  const base = cssTokens('src/components/ticket-design.css', [':root', '.dark', ...dark ? [] : [':root:not(.dark)']]);
  const inks = cssTokens('src/components/points/points-accessibility.css', ['.pg-points-card', ...dark ? [] : [':root:not(.dark) .pg-points-card']]);
  test(`${theme}: all rank/trust text inks exceed 4.5:1 across the actual gradient and tinted details`, () => {
    const gradient = read('src/components/points/PeanutPointsCard.jsx').match(/background: 'linear-gradient\(135deg, rgba\(([^)]+)\) 0%, rgba\(([^)]+)\) 100%\)'/);
    assert.ok(gradient);
    const stops = gradient.slice(1).map(stop => stop.split(',').map(Number));
    const accents = [...points.RANKS.map(rank => rank.color), ...Object.values(points.TRUST_BADGE_DEFS).map(badge => badge.color)];
    for (const surface of ['--pg-canvas', '--pg-surface', '--pg-surface-raised']) {
      for (let step = 0; step <= 100; step++) {
        const backgrounds = stops.map(stop => blend(stop.slice(0, 3), rgb(base[surface]), stop[3]));
        const background = blend(backgrounds[1], backgrounds[0], step / 100);
        for (const accent of accents) {
          const token = pointTextColor(accent).slice(4, -1);
          for (const opacity of [0, 16 / 255, 21 / 255]) {
            const ratio = contrast(rgb(inks[token]), blend(rgb(accent), background, opacity));
            assert.ok(ratio >= 4.5, `${theme} ${accent} on ${surface} at ${step}%/${opacity}: ${ratio.toFixed(2)}:1`);
          }
        }
      }
    }
  });
  test(`${theme}: unselected/selected stars and focus exceed 3:1 on feedback surfaces`, () => {
    const inks = cssTokens('src/components/beta/beta-accessibility.css', ['.pg-beta-feedback', ...dark ? [] : [':root:not(.dark) .pg-beta-feedback']]);
    for (const token of ['--pg-feedback-outline', '--pg-feedback-selected', '--pg-feedback-focus']) for (const surface of ['--pg-surface', '--pg-surface-raised']) {
      assert.ok(contrast(rgb(inks[token]), rgb(base[surface])) >= 3, `${theme} ${token}/${surface}`);
    }
  });
}

test('Help summary bounds large queries without truncating input or splitting surrogate pairs', () => {
  assert.equal(helpQuerySummary('  tickets  '), 'tickets');
  assert.equal(helpQuerySummary('a'.repeat(1000)), `${'a'.repeat(80)}…`);
  assert.equal(helpQuerySummary('🎟'.repeat(90)), `${'🎟'.repeat(80)}…`);
  const source = read('src/pages/HelpCenter.jsx');
  assert.match(source, /value=\{query\}/);
  assert.match(source, /const needle = query\.trim\(\)/);
  assert.match(source, /helpQuerySummary\(query\)/);
  assert.match(source, /Show all topics/);
});
