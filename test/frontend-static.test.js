import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { scopeCss } from '../build-tools/scope-css.mjs';
import ts from '../build-tools/node_modules/typescript/lib/typescript.js';
const root = new URL('../', import.meta.url);
const load = name => readFile(new URL(name, root), 'utf8');

test('all frontend adapter files transpile without syntax errors', async () => {
  const names = (await readdir(new URL('frontend/', root))).filter(name => /\.tsx?$/.test(name)).map(name => 'frontend/' + name);
  for (const name of (await readdir(new URL('frontend/adapters/', root))).filter(name => /\.tsx?$/.test(name))) names.push('frontend/adapters/' + name);
  for (const name of names) {
    const result = ts.transpileModule(await load(name), { fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
    assert.deepEqual((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error), [], name);
  }
});
test('build output matches the latest adapter source snapshots', async () => {
  const report = JSON.parse(await load('dist/build-report.json'));
  assert.ok(report.authoringHashes && Object.keys(report.authoringHashes).length >= 10);
  for (const [name, expected] of Object.entries(report.authoringHashes)) assert.equal(createHash('sha256').update(await readFile(new URL(name, root))).digest('hex'), expected, name + ' requires rebuilding');
  assert.ok(!report.bundledSources.includes('upstream/src/features/demo/demoFixtures.ts'), 'fictional fixtures are excluded');
});
test('vendored compiled page sources are byte-identical to pinned upstream archive', async () => {
  const report = JSON.parse(await load('dist/build-report.json'));
  const expected = JSON.parse(await load('upstream/SOURCE_SHA256.json'));
  for (const name of report.bundledSources) {
    const relative = name.slice('upstream/src/'.length);
    assert.equal(createHash('sha256').update(await readFile(new URL(name, root))).digest('hex'), expected[relative], name);
  }
});
test('CSS scoping preserves keyframe steps and isolates document roots', () => {
  const css = scopeCss(':root{--text-primary:#111} body > #root .item{color:#123456;background:rgba(0,0,0,.2)} @keyframes pulse{from{opacity:0}50%{opacity:.5}to{opacity:1}} .item{animation:pulse 1s}');
  assert.match(css, /\.cpamp-admin/); assert.ok(!/(?:^|\})\s*(?:body|html|:root)\b/.test(css));
  assert.ok(!/#123456|rgba\(0,0,0/.test(css)); assert.match(css, /50%/); assert.match(css, /cpamp/);
  assert.throws(() => scopeCss('body + .outside {color:red}'), /Unsafe/);
});
test('scope explicitly owns history, focus, storage and local body lock', async () => {
  const scope = await load('frontend/scope.ts'); const entry = await load('frontend/entry.tsx'); const css = await load('frontend/host-theme.css');
  assert.ok(scope.includes("if (key === 'history') return localHistory")); assert.ok(scope.includes("if (key === 'activeElement') return scopedActiveElement()"));
  assert.ok(scope.includes('new Map<string, string>()')); assert.ok(!scope.includes('globalThis.localStorage'));
  assert.ok(css.includes('position: relative !important')); assert.ok(css.includes('top: auto !important'));
  assert.ok(entry.includes('data-connection-settings={showSettings')); assert.ok(!entry.includes('isAuthenticated && !showSettings &&'));
});
