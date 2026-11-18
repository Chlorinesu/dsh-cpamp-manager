import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import postcss from '../build-tools/node_modules/postcss/lib/postcss.mjs';
import { accentPalettes, accentThemeCss, colorFamily } from '../frontend/palette.mjs';
import { scopeCss } from '../build-tools/scope-css.mjs';
import ts from '../build-tools/node_modules/typescript/lib/typescript.js';
const root = new URL('../', import.meta.url);
const load = path => readFile(new URL(path, root), 'utf8');
const luminance = hex => {
  const rgb = hex.slice(1).match(/../g).slice(0, 3).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

test('blue primary buttons meet AA contrast in both themes and all states', () => {
  for (const [theme, palette] of Object.entries(accentPalettes)) {
    for (const state of ['solid', 'solidHover', 'solidActive']) assert.ok(contrast(palette[state], palette.onSolid) >= 4.5, `${theme}/${state}`);
    assert.equal(colorFamily(...palette.accent.slice(1).match(/../g).map(v => parseInt(v, 16))), 'blue');
  }
});
test('accent CSS only overrides the CPAMP root and does not recolor Host surfaces or labels', () => {
  const css = postcss.parse(accentThemeCss());
  assert.deepEqual(css.nodes.map(n => n.selector), ['.cpamp-admin', '.cpamp-admin[data-theme="dark"]']);
  css.walkDecls(d => assert.ok(d.prop.startsWith('--cpamp-') || d.prop === '--dsw-alias-brand-primary', d.prop));
  for (const theme of Object.values(accentPalettes)) assert.equal(new Set(['blue', 'violet', 'cyan', 'teal', 'emerald'].map(key => theme[key])).size, 5);
});
test('CSS series preserve distinct blue/violet/cyan and translucent fill', () => {
  const css = scopeCss(':root{--data-blue-base:#3b82f6;--data-violet-base:#8b5cf6;--data-cyan-base:#06b6d4;--data-teal-base:#14b8a6;--data-emerald-base:#10b981}.blue{color:#3b82f6}.violet{color:#8b5cf6}.cyan{color:#06b6d4}.area{background:rgba(59,130,246,.15)}');
  for (const name of ['blue', 'violet', 'cyan', 'teal', 'emerald']) assert.ok(css.includes(`var(--cpamp-chart-${name})`), name);
  assert.ok(css.includes('15%')); assert.ok(css.includes('transparent'));
});
test('original chart light/dark HEX palettes and opacity helpers are intact', async () => {
  const source = await load('upstream/src/utils/dataPalette.ts');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  // Pure palette values and helpers only: no React, browser, document or DOM emulation.
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports });
  const { lightDataPalette, darkDataPalette, getDataPalette, hexToRgba } = mod.exports;
  assert.equal(getDataPalette('dark'), darkDataPalette); assert.equal(getDataPalette('light'), lightDataPalette);
  for (const palette of [lightDataPalette, darkDataPalette]) assert.equal(new Set(['blue', 'violet', 'cyan', 'green', 'amber', 'red'].map(k => palette[k])).size, 6);
  assert.equal(hexToRgba(lightDataPalette.blue, .12), 'rgba(59,130,246,0.12)');
  assert.equal(hexToRgba(darkDataPalette.blue, .2), 'rgba(96,165,250,0.2)');
  const builder = await load('build-tools/build.mjs');
  assert.ok(!builder.includes('__cpampColor')); assert.ok(!builder.includes('ts.isStringLiteral(node)'));
});
test('semantic Host colors stay inherited and button/badge contrast tokens stay separate', async () => {
  const css = await load('frontend/host-theme.css');
  assert.ok(css.includes('--text-primary: var(--dsw-alias-label-primary)'));
  assert.ok(css.includes('background: var(--dsw-alias-bg-base)'));
  assert.ok(css.includes('--primary-contrast: var(--cpamp-on-solid)'));
  const badge = scopeCss('.rank[data-rank="1"]{background:#f59e0b;color:var(--primary-contrast,#fff)}');
  assert.ok(badge.includes('var(--cpamp-on-badge)'));
});
