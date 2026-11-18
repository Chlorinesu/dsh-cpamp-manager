import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const load = path => readFile(new URL(path, root), 'utf8');

test('public beta has no embedded server default or private package flag', async () => {
  const pkg = JSON.parse(await load('package.json'));
  assert.equal(pkg.name, 'dsh-cpamp-manager'); assert.equal(pkg.version, '0.1.0-beta.1'); assert.ok(!pkg.private);
  assert.ok(!pkg.scripts.install && !pkg.scripts.prepare && !pkg.scripts.postinstall);
  assert.ok((await load('monitor.js')).includes("export const DEFAULT_URL = ''"));
  assert.ok((await load('frontend/entry.tsx')).includes("const DEFAULT_URL = ''"));
  assert.ok(!pkg.files.includes('client.js'));
  assert.ok(!pkg.files.some(path => path.includes('node_modules') || path.startsWith('release-tools')));
});
test('runtime bundle has no local username, original private endpoint or author-machine path', async () => {
  const bundle = await load('dist/client.js');
  assert.ok(!/default-workspace|[A-Z]:[\\/]+Users[\\/]/i.test(bundle));
  assert.ok((await load('frontend/scope.ts')).includes("let serviceBase = 'https://cpamp.example.invalid'"));
  assert.ok(bundle.startsWith("window.__ModuleLoader__.load({id:'dsh-cpamp-manager',factory(require){"));
});
test('release retains provenance and source-integrity baseline without external checkout dependency', async () => {
  assert.match(await load('upstream/LICENSE'), /Copyright \(c\) 2026 Seakee/);
  assert.match(await load('THIRD_PARTY_NOTICES.md'), /unofficial/);
  const hashes = JSON.parse(await load('upstream/SOURCE_SHA256.json')); assert.ok(Object.keys(hashes).length > 500);
  assert.ok(!(await load('test/frontend-static.test.js')).includes('../CPA-Manager-Plus-1.14.10'));
});
