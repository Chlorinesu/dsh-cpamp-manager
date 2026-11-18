import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const load = async path => readFile(new URL(path, root), 'utf8');

test('manifest keeps stable package identity, native runtime exports and no install dependencies', async () => {
  const pkg = JSON.parse(await load('package.json'));
  assert.equal(pkg.name, 'dsh-cpamp-manager'); assert.equal(pkg.version, '0.1.0-beta.1'); assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.exports['.'], './admin.js'); assert.equal(pkg.exports['./client'], './dist/client.js');
  assert.equal(pkg.dsh.client.immediately, true); assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.ok(!pkg.dependencies); assert.ok(!pkg.scripts.install); assert.ok(!pkg.scripts.postinstall);
  for (const path of [pkg.exports['.'], pkg.exports['./client'], pkg.exports['./icon'], pkg.dsh.bundle.patch, './README.md', './LICENSE', './locale/zh.json', './locale/en.json', './upstream/LICENSE', './upstream/VERSION']) await access(new URL(path, root));
  const svg = await load('icon.svg'); assert.ok(svg.includes('viewBox="0 0 36 36"')); assert.ok(!/<(?:script|image|foreignObject|style)\b/i.test(svg));
});
test('compiled client parses in the Harness lazy module format with shared React', async () => {
  const client = await load('dist/client.js'); new vm.Script(client, { filename: fileURLToPath(new URL('dist/client.js', root)) });
  assert.ok(client.startsWith("window.__ModuleLoader__.load({id:'dsh-cpamp-manager',factory(require){"));
  const report = JSON.parse(await load('dist/build-report.json'));
  assert.ok(report.sourceModules > 500); assert.ok(report.artifactBytes > 1000000);
  assert.deepEqual([...report.externalRequests].sort(), ['react', 'react-dom', 'react/jsx-runtime']);
  assert.ok(!report.externalRequests.some(name => name.startsWith('@deepseek-ai/')));
  for (const path of ['upstream/src/components/layout/MainLayout.tsx', 'upstream/src/router/MainRoutes.tsx', 'upstream/src/app/RootShell.tsx']) assert.ok(report.bundledSources.includes(path), path);
});
test('native entry keeps matching slots, component-owned rendering and memory router', async () => {
  const entry = await load('frontend/entry.tsx'); const router = await load('frontend/router.tsx');
  assert.ok(entry.includes("name: 'sidebar.panellist', id: 'cpamp-monitor', order: 20")); assert.ok(entry.includes("name: 'main', key: 'cpamp-monitor'"));
  assert.ok(entry.includes('attachShadow')); assert.ok(entry.includes('createPortal(content, shadowRoot)')); assert.ok(!entry.includes('createRoot('));
  assert.ok(router.includes('createMemoryRouter')); assert.ok(!router.includes('createHashRouter'));
  assert.ok(!/iframe|dangerouslySetInnerHTML/.test(await load('frontend/adapters/PluginResourcePage.tsx')));
});
test('localized display metadata remains bilingual and accurately describes full human management', async () => {
  const en = JSON.parse(await load('locale/en.json')); const zh = JSON.parse(await load('locale/zh.json'));
  const keys = o => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? keys(v).map(s => k + '.' + s) : [k]).sort();
  assert.deepEqual(keys(en), keys(zh)); assert.equal(en.meta.title, 'CPAMP manager'); assert.equal(zh.meta.title, 'CPAMP 管理后台');
  assert.match(en.meta.description, /Agent tool remains read-only/); assert.match(zh.meta.description, /Agent 工具仍只读/);
});
test('Host tools remain the original read-only status/query tool', async () => {
  const admin = await load('admin.js'); const bridge = await load('admin-bridge.js'); const original = await load('index.js');
  assert.ok(admin.includes('applyMonitor(ctx)')); assert.ok(!bridge.includes('tools.register'));
  assert.ok(original.includes("enum: ['status', 'query']")); assert.ok(!original.includes("case 'proxy'"));
  assert.ok(!bridge.includes('rejectUnauthorized: false')); assert.ok(bridge.includes("redirect: 'error'"));
});
