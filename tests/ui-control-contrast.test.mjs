import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const parsed = path => postcss.parse(read(path));
const styles = ['src/index.css', 'src/components/ticket-design.css', 'src/components/control-contrast.css'].map(parsed);
const control = parsed('src/components/control-contrast.css');
function themeTokens(dark) {
  const values = {};
  for (const css of styles) css.walkRules(rule => {
    if (rule.selectors.some(selector => selector === ':root' || selector === ':root, .dark'
      || (dark && ['.dark', ':root.dark'].includes(selector)) || (!dark && selector === ':root:not(.dark)'))) {
      rule.nodes.filter(node => node.type === 'decl' && node.prop.startsWith('--')).forEach(node => { values[node.prop] = node.value; });
    }
  });
  return values;
}
function property(css, selector, name) {
  let value;
  css.walkRules(rule => { if (rule.selectors.includes(selector)) rule.walkDecls(name, node => { value = node.value; }); });
  assert.ok(value, `${selector} needs ${name}`);
  return value;
}
function color(value, tokens) {
  if (value.startsWith('var(')) return color(tokens[value.match(/var\((--[\w-]+)/)[1]], tokens);
  if (value.startsWith('#')) return value.slice(1).match(/.{2}/g).map(part => parseInt(part, 16));
  throw new Error(`Unsupported tested color: ${value}`);
}
const luminance = rgb => rgb.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  .reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
function contrast(a, b) { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); }
function minimum(a, b, ratio, description) { const measured = contrast(a, b); assert.ok(measured >= ratio, `${description}: ${measured.toFixed(2)}:1 < ${ratio}:1`); return measured; }
const blend = (ink, base, alpha) => ink.map((channel, i) => channel * alpha + base[i] * (1 - alpha));
function specificity(selector) {
  function score(node) {
    if (node.type === 'id') return 10000;
    if (['class', 'attribute'].includes(node.type)) return 100;
    if (node.type === 'tag' || (node.type === 'pseudo' && node.value.startsWith('::'))) return 1;
    if (node.type === 'pseudo') {
      if (node.value === ':where') return 0;
      if ([':is', ':not', ':has'].includes(node.value)) return Math.max(...node.nodes.map(score));
      return 100;
    }
    return (node.nodes || []).reduce((sum, child) => sum + score(child), 0);
  }
  return score(selectorParser().astSync(selector).nodes[0]);
}

for (const dark of [false, true]) {
  const label = dark ? 'dark' : 'light';
  const tokens = themeTokens(dark);
  const get = key => color(tokens[key], tokens);
  test(`${label}: active inputs and switches exceed 3:1 using actual CSS token values`, () => {
    for (const background of ['--pg-canvas', '--pg-surface', '--pg-surface-raised', '--pg-control-fill']) {
      for (const state of ['--pg-control-border', '--pg-control-hover', '--pg-control-focus', '--pg-control-error']) {
        minimum(get(state), get(background), 3, `${label} ${state}/${background}`);
      }
      for (const state of ['--pg-switch-off', '--pg-switch-on']) minimum(get(state), get(background), 3, `${label} ${state}/${background}`);
    }
    for (const state of ['--pg-switch-off', '--pg-switch-on']) minimum(get('--pg-switch-thumb'), get(state), 3, `${label} thumb/${state}`);
    minimum(get('--pg-control-text'), get('--pg-control-fill'), 4.5, `${label} input/autofill text`);
    for (const tint of ['--neon-cyan', '--neon-green']) {
      minimum(get('--pg-control-border'), blend(get(tint), get('--pg-surface'), .05), 3, `${label} optional/price tinted field boundary`);
    }
  });
  test(`${label}: seller chooser paper title, metadata and active button retain contrast`, () => {
    const css = parsed('src/components/events/detail-ticket.css');
    const paper = color(property(css, '.pg-selling-picker > article', 'background'), tokens);
    minimum(color(property(css, '.pg-selling-picker.pg-detail-surface > article h2', 'color'), tokens), paper, 4.5, 'ordinary paper title');
    minimum(color(property(css, '.pg-selling-picker > article .text-muted-foreground', 'color'), tokens), paper, 4.5, 'paper metadata');
    const button = color(property(css, '.pg-selling-picker > article button', 'background'), tokens);
    minimum(color(property(css, '.pg-selling-picker > article button', 'color'), tokens), button, 4.5, 'select event');
    minimum(color(property(css, '.pg-selling-picker > article button:focus-visible', 'outline-color'), tokens), button, 3, 'inset select focus');
  });
  test(`${label}: small Why accents retain 4.5:1 including tinted panels`, () => {
    for (const accent of ['green', 'cyan', 'purple', 'pink', 'yellow']) {
      const ink = get(`--neon-${accent}`);
      for (const surface of ['--pg-canvas', '--pg-surface', ...(accent === 'green' ? ['--pg-surface-raised'] : [])]) minimum(ink, get(surface), 4.5, `${label} ${accent}/${surface}`);
      minimum(ink, blend(ink, get('--pg-canvas'), .06), 4.5, `${label} ${accent}/6% panel`);
    }
  });
}

test('seller title paper rule wins the real competing :is heading specificity in either load order', () => {
  const css = parsed('src/components/events/detail-ticket.css');
  let paperSelector;
  const headingCompetitors = [];
  css.walkRules(rule => rule.walkDecls('color', declaration => {
    for (const selector of rule.selectors) {
      if (selector.includes('.pg-selling-picker') && selector.endsWith('h2') && declaration.value === 'var(--pg-ink)') paperSelector = selector;
      if (selector.includes('.pg-detail-surface') && selector.includes('h2') && declaration.value === 'var(--pg-text)') headingCompetitors.push(selector);
    }
  }));
  assert.ok(paperSelector);
  assert.ok(headingCompetitors.length);
  for (const competitor of headingCompetitors) assert.ok(specificity(paperSelector) > specificity(competitor), `${paperSelector} must beat ${competitor}`);
});

test('image-back ink and inset focus exceed 4.5:1 over worst-case white and dark images', () => {
  const css = parsed('src/pages/event-detail-clarity.css');
  const selector = '.pg-event-detail .pg-event-back';
  const tokens = { '--pg-overlay-ink': property(css, selector, '--pg-overlay-ink'), '--pg-overlay-surface': property(css, selector, '--pg-overlay-surface') };
  const values = tokens['--pg-overlay-surface'].match(/[\d.]+/g).map(Number);
  const ink = color(property(css, selector, 'color'), tokens);
  assert.equal(property(css, selector, 'background'), 'var(--pg-overlay-surface)');
  assert.match(property(css, '.pg-event-detail .pg-event-hero-photo a.pg-event-back:focus-visible', 'outline'), /var\(--pg-overlay-ink\)/);
  for (const backdrop of [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 255]]) minimum(ink, blend(values.slice(0, 3), backdrop, values[3]), 4.5, 'image-back composited overlay');
});

test('interactive states use separate boundaries; autofill preserves text and disabled controls are exempt', () => {
  assert.equal(property(control, ':is(.pg-control-input, .pg-auth-input):enabled:hover', '--pg-field-boundary'), 'var(--pg-control-hover)');
  assert.equal(property(control, ':is(.pg-control-input, .pg-auth-input):enabled:focus-visible', '--pg-field-boundary'), 'var(--pg-control-focus)');
  assert.equal(property(control, ":is(.pg-control-input, .pg-auth-input)[aria-invalid='true']", '--pg-field-boundary'), 'var(--pg-control-error)');
  assert.match(property(control, ':is(.pg-control-input, .pg-auth-input):-webkit-autofill', '-webkit-text-fill-color'), /--pg-control-text/);
  assert.match(property(control, ':is(.pg-control-input, .pg-auth-input):autofill', 'box-shadow'), /--pg-control-fill/);
  assert.ok(Number(property(control, ':is(.pg-control-input, .pg-auth-input):disabled', 'opacity')) < 1);
  assert.match(read('src/components/ticket-design.css'), /@import '\.\/control-contrast.css'/);
  assert.match(read('src/components/ui/input.jsx'), /pg-control-input/);
  assert.match(read('src/components/ui/switch.jsx'), /pg-switch-thumb/);
  assert.match(read('src/pages/CreateListing.jsx'), /const inputClass = `pg-control-input/);
});
