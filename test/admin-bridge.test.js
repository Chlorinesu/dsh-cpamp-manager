import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminBridge, validateApiHelper, isPrivateAddress, registerAdminRoutes } from '../admin-bridge.js';
import { RECORD_KEY } from '../monitor.js';
const binding = { baseUrl: 'https://manager.example.test/mount', adminKey: 'test-admin-secret' };
const credentials = { async readRecord(key) { assert.equal(key, RECORD_KEY); return { kind: 'grant', payload: binding }; } };
const makeRequest = (method, path, body, confirmed = false, extra = {}) => new Request('http://localhost/api/cpamp-admin/bridge', {
  method: 'POST', headers: { 'x-cpamp-method': method, 'x-cpamp-path': encodeURIComponent(path), ...(body ? { 'content-type': 'application/json' } : {}), ...(confirmed ? { 'x-cpamp-confirmed': '1' } : {}), ...extra }, body,
});
const expectCode = value => e => { assert.equal(e.code, value); return true; };

test('admin bridge uses saved endpoint/key and strips browser authority headers', async () => {
  let calls = 0;
  const bridge = createAdminBridge({ credentials, fetchImpl: async (url, init) => {
    calls++; assert.equal(url.href, binding.baseUrl + '/v0/management/config'); assert.equal(init.method, 'GET');
    assert.equal(init.headers.get('authorization'), 'Bearer ' + binding.adminKey); assert.equal(init.headers.get('cookie'), null); assert.equal(init.redirect, 'error');
    return new Response('{"configured":true}', { headers: { 'content-type': 'application/json', 'set-cookie': 'must-not-leak', 'x-cpa-version': 'v7.3.4', 'location': 'https://not-forwarded.test' } });
  } });
  const response = await bridge.proxy(makeRequest('GET', '/v0/management/config', null, false, { authorization: 'Bearer browser-secret', cookie: 'browser-cookie' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).configured, true); assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('location'), null); assert.equal(response.headers.get('x-cpa-version'), 'v7.3.4'); assert.equal(calls, 1);
});
test('writes are denied until explicit owner UI confirmation', async () => {
  let calls = 0;
  const bridge = createAdminBridge({ credentials, fetchImpl: async (_url, init) => { calls++; assert.equal(init.method, 'PUT'); assert.equal(new TextDecoder().decode(init.body), '{"debug":true}'); return new Response(null, { status: 204 }); } });
  const denied = await bridge.proxy(makeRequest('PUT', '/usage-service/config', '{"debug":true}'));
  assert.equal((await denied.json()).code, 'CONFIRMATION_REQUIRED'); assert.equal(calls, 0);
  const allowed = await bridge.proxy(makeRequest('PUT', '/usage-service/config', '{"debug":true}', true)); assert.equal(allowed.status, 204); assert.equal(await allowed.text(), ''); assert.equal(calls, 1);
});
test('fixed analytics POST remains semantic read-only without confirmation', async () => {
  const bridge = createAdminBridge({ credentials, fetchImpl: async (_url, init) => { assert.equal(init.method, 'POST'); return Response.json({ generated_at_ms: 1 }); } });
  const response = await bridge.proxy(makeRequest('POST', '/v0/management/monitoring/analytics', '{}')); assert.equal(response.status, 200); assert.equal((await response.json()).generated_at_ms, 1);
});
test('unknown routes, absolute URLs and path traversal never reach upstream', async () => {
  const bridge = createAdminBridge({ credentials, fetchImpl: async () => { throw new Error('should not fetch'); } });
  for (const path of ['/v0/management/unregistered-operation', 'https://evil.test/v0/management/config', '//evil.test/config', '/v0/management/../config', '/v0/management/%2e%2e/config', '/v0/management/config%2f..%2fsecret', '/v0/resource/plugins/panel.html']) {
    const response = await bridge.proxy(makeRequest('GET', path)); assert.equal((await response.json()).code, 'FORBIDDEN', path);
  }
});
test('multipart uploads and binary downloads preserve data and media type', async () => {
  const form = new FormData(); form.append('file', new Blob(['example-credential'], { type: 'application/json' }), 'example.json');
  const request = new Request('http://localhost/api/cpamp-admin/bridge', { method: 'POST', headers: { 'x-cpamp-method': 'POST', 'x-cpamp-path': encodeURIComponent('/v0/management/auth-files'), 'x-cpamp-confirmed': '1' }, body: form });
  const bridge = createAdminBridge({ credentials, fetchImpl: async (_url, init) => { assert.match(init.headers.get('content-type'), /^multipart\/form-data; boundary=/); assert.match(new TextDecoder().decode(init.body), /example-credential/); return new Response(new Uint8Array([0, 1, 2, 255]), { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="example.bin"' } }); } });
  const response = await bridge.proxy(request); assert.equal(response.status, 200); assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 1, 2, 255]); assert.match(response.headers.get('content-disposition'), /example.bin/);
});
test('provider helper rejects private destinations and management credential forwarding', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1', '192.168.1.1', '::1', '::ffff:7f00:1', 'fd00::1']) assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('8.8.8.8'), false); assert.equal(isPrivateAddress('2606:4700::1111'), false);
  const publicDns = async () => [{ address: '8.8.8.8' }];
  for (const url of ['http://api.example.test/v1/models', 'https://localhost/v1/models', 'https://127.0.0.1/v1/models', 'https://api.example.test:60000/v1/models', 'https://manager.example.test/mount/v0/management/config']) {
    await assert.rejects(validateApiHelper({ method: 'GET', url }, binding, publicDns), expectCode('FORBIDDEN'));
  }
  await assert.rejects(validateApiHelper({ method: 'GET', url: 'https://api.example.test/v1/models', header: { authorization: binding.adminKey } }, binding, publicDns), expectCode('FORBIDDEN'));
  await assert.rejects(validateApiHelper({ method: 'DELETE', url: 'https://api.example.test/v1/models' }, binding, publicDns), expectCode('FORBIDDEN'));
  await validateApiHelper({ method: 'GET', url: 'https://api.example.test/v1/models', header: { Authorization: 'Bearer provider-test-key' } }, binding, publicDns);
});
test('missing credentials and network failures return safe actionable errors', async () => {
  const missing = createAdminBridge({ credentials: { async readRecord() { return undefined; } } });
  assert.equal((await (await missing.proxy(makeRequest('GET', '/v0/management/config'))).json()).code, 'NOT_CONFIGURED');
  const failure = createAdminBridge({ credentials, fetchImpl: async () => { throw Object.assign(new Error('must not disclose ' + binding.adminKey), { cause: { code: 'CERT_HAS_EXPIRED' } }); } });
  const response = await failure.proxy(makeRequest('GET', '/v0/management/config')); const body = await response.text(); assert.ok(!body.includes(binding.adminKey)); assert.equal(JSON.parse(body).code, 'TLS_ERROR');
});
test('model listing never forwards the CPAMP Admin Key', async () => {
  let calls = 0;
  const bridge = createAdminBridge({ credentials, fetchImpl: async (_url, init) => { calls++; assert.equal(init.headers.get('authorization'), 'Bearer cpa-client-key'); return Response.json({ data: [] }); } });
  for (const headers of [{}, { 'x-cpamp-model-authorization': 'Bearer ' + binding.adminKey }, { 'x-cpamp-model-authorization': 'Bearer harness-host-managed-credential' }]) {
    assert.equal((await (await bridge.proxy(makeRequest('GET', '/v1/models', null, false, headers))).json()).code, 'KEY_REQUIRED');
  }
  const response = await bridge.proxy(makeRequest('GET', '/v1/models', null, false, { 'x-cpamp-model-authorization': 'Bearer cpa-client-key' })); assert.equal(response.status, 200); await response.text(); assert.equal(calls, 1);
});
test('known quota helper reads and non-catch-up account history avoid write prompts', async () => {
  let calls = 0;
  const bridge = createAdminBridge({ credentials, lookupImpl: async () => [{ address: '8.8.8.8' }], fetchImpl: async () => { calls++; return Response.json({ ok: true }); } });
  const quota = { authIndex: 'account-1', method: 'GET', url: 'https://chatgpt.com/backend-api/wham/usage', header: { Authorization: 'Bearer $TOKEN$' } };
  let response = await bridge.proxy(makeRequest('POST', '/v0/management/api-call', JSON.stringify(quota))); assert.equal(response.status, 200); await response.text();
  response = await bridge.proxy(makeRequest('POST', '/v0/management/monitoring/account-history', '{"catch_up":false}')); assert.equal(response.status, 200); await response.text();
  response = await bridge.proxy(makeRequest('POST', '/v0/management/monitoring/account-history', '{"catch_up":true}')); assert.equal((await response.json()).code, 'CONFIRMATION_REQUIRED');
  response = await bridge.proxy(makeRequest('POST', '/v0/management/api-call', JSON.stringify({ ...quota, url: 'https://api.example.test/v1/responses' }))); assert.equal((await response.json()).code, 'CONFIRMATION_REQUIRED'); assert.equal(calls, 2);
});
test('public release uses one fixed anonymous URL and owner-only routes are registered', async () => {
  const bridge = createAdminBridge({ credentials, fetchImpl: async (url, init) => { assert.equal(url, 'https://raw.githubusercontent.com/seakee/CPA-Manager-Plus/update-channel/update-index.json'); assert.equal(init.headers.authorization, undefined); return Response.json({ version: 'example' }); } });
  assert.equal((await (await bridge.release(new Request('http://localhost/api/cpamp-admin/public-release'))).json()).version, 'example');
  const routes = []; const ctx = { credentials, effect(fn) { return fn(); }, connection: { admit: () => ({ rejection: 403 }), fetch: { register(route) { routes.push(route); return () => {}; } } } };
  registerAdminRoutes(ctx, new AbortController().signal); assert.equal(routes.length, 2);
  for (const route of routes) assert.equal((await route.fetch(new Request('http://localhost' + route.path))).status, 403);
});
