import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from '../build-tools/node_modules/postcss/lib/postcss.mjs';
import { APPEARANCE_IDS, APPEARANCE_KEY, DEFAULT_APPEARANCE, loadAppearance, normalizeAppearance, saveAppearance, surfacePalettes, surfaceThemeCss } from '../frontend/appearance.mjs';
import { accentPalettes } from '../frontend/palette.mjs';
const load = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const lum = hex => {
  const values = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);

test('four selectable presets default to mist with safe input normalization', () => {
  assert.deepEqual(APPEARANCE_IDS, ['mist', 'ice', 'sand', 'host']); assert.equal(DEFAULT_APPEARANCE, 'mist');
  for (const value of [null, undefined, '', 'invalid', '<style>', {}, []]) assert.equal(normalizeAppearance(value), 'mist');
  for (const id of APPEARANCE_IDS) assert.equal(normalizeAppearance(id), id);
});
test('only an appearance ID is saved under an isolated preference key', () => {
  const records = new Map(); const store = { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) };
  assert.equal(loadAppearance(store), 'mist'); assert.equal(saveAppearance(store, 'ice'), true); assert.equal(loadAppearance(store), 'ice');
  assert.deepEqual([...records], [[APPEARANCE_KEY, 'ice']]); assert.equal(saveAppearance(store, 'host'), true); assert.equal(loadAppearance(store), 'host');
  assert.equal(saveAppearance(undefined, 'sand'), false); assert.equal(loadAppearance(undefined), 'mist');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadAppearance(blocked), 'mist'); assert.equal(saveAppearance(blocked, 'ice'), false);
});
test('every custom theme separates page and card while keeping text readable', () => {
  for (const [id, modes] of Object.entries(surfacePalettes)) for (const [mode, palette] of Object.entries(modes)) {
    assert.ok(ratio(palette.base, palette.card) >= 1.08, `${id}/${mode}: raised card hierarchy`);
    assert.notEqual(palette.base, palette.nested); assert.notEqual(palette.card, palette.nested);
    for (const surface of ['base', 'card', 'nested', 'overlay']) {
      assert.ok(ratio(palette.text, palette[surface]) >= 7, `${id}/${mode}/${surface}: body text`);
      assert.ok(ratio(palette.secondary, palette[surface]) >= 4.5, `${id}/${mode}/${surface}: secondary text`);
    }
    const accent = mode === 'dark' ? '#60a5fa' : '#1d4ed8';
    for (const surface of ['base', 'card', 'nested', 'overlay']) assert.ok(ratio(accent, palette[surface]) >= 4.5, `${id}/${mode}/${surface}: accent links`);
    assert.ok(ratio(accentPalettes[mode].solid, accentPalettes[mode].onSolid) >= 4.5);
  }
});
test('surface CSS has only scoped preset roots; follow-Host defines no surface overrides', () => {
  const ast = postcss.parse(surfaceThemeCss());
  assert.equal(ast.nodes.length, 6);
  ast.walkRules(rule => assert.match(rule.selector, /^\.cpamp-admin\[data-palette="(?:mist|ice|sand)"\](?:\[data-theme="dark"\])?$/));
  ast.walkDecls(d => assert.ok(d.prop.startsWith('--dsw-alias-') || d.prop === 'color-scheme'));
  assert.ok(!surfaceThemeCss().includes('data-palette="host"'));
  assert.equal(new Set(Object.values(surfacePalettes).map(modes => modes.white.base)).size, 3);
  assert.equal(new Set(Object.values(surfacePalettes).map(modes => modes.dark.base)).size, 3);
});
test('palette switching does not remount the upstream editor or alter connection generation', async () => {
  const entry = await load('frontend/entry.tsx');
  const change = entry.slice(entry.indexOf('const chooseAppearance ='), entry.indexOf('const reconcile ='));
  assert.ok(change.includes('setAppearance(id)')); assert.ok(change.includes('saveAppearance')); assert.ok(!/setGeneration|reconcile\(|connectionAction|setShowSettings/.test(change));
  assert.ok(entry.includes('data-palette={appearance}')); assert.ok(entry.includes('aria-label={t(\'appearance\')}'));
  assert.ok(entry.includes("ctx.on('theme/change', refreshScopeTheme)")); assert.ok(entry.includes('stopThemeSync()'));
  const scope = await load('frontend/scope.ts');
  assert.ok(scope.includes('readHostColorScheme?.()')); assert.ok(!scope.includes('getComputedStyle(root)'));
});
