import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor, normalizeBaseUrl, projectResponse, validateQuery, publicError, RECORD_KEY } from '../monitor.js';
import { apply } from '../index.js';

const baseUrl = 'https://example.test/cpamp';
const now = Date.now() - 1000;
const range = { fromMs: now - 3600000, toMs: now, timeZone: 'Asia/Shanghai', kind: 'overview' };
const fixture = () => ({ generated_at_ms: now,
  summary: { total_calls: 5, success_calls: 4, failure_calls: 1, total_tokens: 100, input_tokens: 60, output_tokens: 40, total_cost: 0.2, admin_key: 'never-show' },
  model_stats: [{ model: 'example-model', calls: 5, success_calls: 4, failure_calls: 1, total_tokens: 100, cost: 0.2, api_key: 'never-show' }],
  timeline: [{ bucket_ms: now - 10000, calls: 5, tokens: 100, failure: 1, cost: 0.2 }],
  coverage: { raw_complete: false, mode: 'hybrid', fidelity_limitations: ['retention'] },
});
function store(binding = { baseUrl, adminKey: 'secret-test-key' }) {
  let record = binding ? { kind: 'grant', payload: binding } : undefined;
  return { async readRecord(key) { assert.equal(key, RECORD_KEY); return structuredClone(record); },
    async modifyRecord(key, mutate) { assert.equal(key, RECORD_KEY); record = await mutate(record); return record; },
    async deleteRecord(key) { assert.equal(key, RECORD_KEY); record = undefined; } };
}
const ok = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const code = expected => e => { assert.equal(e.code, expected); return true; };

test('server URL normalizes management page and preserves mount', () => {
  assert.equal(normalizeBaseUrl('https://example.test/cpamp/management.html#/usage'), baseUrl);
  assert.equal(normalizeBaseUrl('http://localhost:18317/'), 'http://localhost:18317');
  assert.equal(normalizeBaseUrl('http://[::1]:18317'), 'http://[::1]:18317');
  for (const url of ['http://remote.test', 'file:///C:/secret', 'https://user:key@example.test', 'https://example.test?token=bad', 'not a url']) assert.throws(() => normalizeBaseUrl(url), code('INVALID_URL'));
});
test('range, timezone and paired cursors are strictly checked', () => {
  assert.equal(validateQuery(range).timeZone, 'Asia/Shanghai');
  for (const override of [{ fromMs: 0 }, { toMs: range.fromMs }, { fromMs: now - 33 * 86400000 }, { timeZone: 'invalid/timezone' }, { kind: 'delete' }, { beforeMs: now }]) assert.throws(() => validateQuery({ ...range, ...override }), code('INVALID_INPUT'));
});
test('overview uses one fixed semantic read-only POST with redacted projection', async () => {
  let calls = 0;
  const monitor = createMonitor({ credentials: store(), fetchImpl: async (url, options) => {
    calls++; assert.equal(url.href, baseUrl + '/v0/management/monitoring/analytics');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer secret-test-key');
    assert.deepEqual(JSON.parse(options.body), { from_ms: range.fromMs, to_ms: range.toMs, time_zone: range.timeZone, filters: { include_failed: true }, include: { summary: true, summary_profile: 'compact', timeline: true, model_stats: true } });
    return ok(fixture());
  } });
  const result = await monitor.query(range);
  assert.equal(result.summary.calls, 5); assert.equal(result.summary.cost, 0.2); assert.equal(result.summary.cachedTokens, null);
  assert.equal(result.models[0].calls, 5); assert.equal(result.timeline[0].tokens, 100);
  assert.equal(result.coverage.rawComplete, false);
  assert.ok(!JSON.stringify(result).includes('never-show'));
  result.summary.calls = 999;
  assert.equal((await monitor.query(range)).summary.calls, 5); assert.equal(calls, 1);
});
test('empty omitempty model/timeline arrays are supported, missing metrics are not zero', () => {
  const result = projectResponse({ generated_at_ms: now, summary: { total_calls: 0 } }, 'overview');
  assert.deepEqual(result.models, []); assert.deepEqual(result.timeline, []); assert.equal(result.summary.tokens, null);
});
test('incompatible response is rejected rather than silently displaying zero', () => {
  for (const raw of [{}, { generated_at_ms: now }, { generated_at_ms: now, summary: {} }, { generated_at_ms: now, summary: { total_calls: 0 }, timeline: {} }]) assert.throws(() => projectResponse(raw, 'overview'), code('INVALID_RESPONSE'));
});
test('events only requests a bounded page and forwards both cursors', async () => {
  const monitor = createMonitor({ credentials: store(), fetchImpl: async (_url, options) => {
    const input = JSON.parse(options.body);
    assert.deepEqual(input.include, { events_page: { limit: 50, before_ms: now - 100, before_id: 7 } });
    return ok({ generated_at_ms: now, events: { items: [{ timestamp_ms: now - 200, model: 'model', total_tokens: 3, failed: true, fail_status_code: 429, fail_summary: 'private evidence', api_key_hash: 'private hash', account_snapshot: 'private account', raw: 'private raw' }], has_more: true, next_before_ms: now - 200, next_before_id: 6, total_count: 99 } });
  } });
  const value = await monitor.query({ ...range, kind: 'events', beforeMs: now - 100, beforeId: 7 });
  assert.equal(value.items[0].statusCode, 429); assert.equal(value.items[0].latencyMs, null); assert.equal(value.totalCount, 99); assert.equal(value.nextBeforeId, 6);
  assert.ok(!JSON.stringify(value).includes('private'));
});
test('empty Go events slices accept null but reject malformed non-arrays', () => {
  for (const items of [null, undefined, []]) assert.deepEqual(projectResponse({ generated_at_ms: now, events: { items, has_more: false, total_count: 0 } }, 'events').items, []);
  for (const items of [{}, 'bad']) assert.throws(() => projectResponse({ generated_at_ms: now, events: { items } }, 'events'), code('INVALID_RESPONSE'));
});
test('status and unconfigured failures do not expose secrets', async () => {
  const monitor = createMonitor({ credentials: store(), fetchImpl: () => { throw new Error('must not query'); } });
  assert.deepEqual(await monitor.status(), { configured: true, hasKey: true, baseUrl });
  await monitor.disconnect(); assert.equal((await monitor.status()).configured, false);
  await assert.rejects(monitor.query(range), code('NOT_CONFIGURED'));
});
test('configuration verifies candidate before atomically replacing binding', async () => {
  const credentials = store(); let auth;
  const monitor = createMonitor({ credentials, fetchImpl: async (_u, opts) => { auth = opts.headers.authorization; return ok(fixture()); } });
  await monitor.configure({ baseUrl: baseUrl + '/management.html', adminKey: '' });
  assert.equal(auth, 'Bearer secret-test-key');
  await assert.rejects(monitor.configure({ baseUrl: 'https://other.test', adminKey: '' }), code('KEY_REQUIRED'));
  assert.equal((await monitor.status()).baseUrl, baseUrl);
  await monitor.configure({ baseUrl: 'https://other.test', adminKey: 'new-secret' });
  assert.equal(auth, 'Bearer new-secret'); assert.equal((await monitor.status()).baseUrl, 'https://other.test');
});
test('failed credential verification preserves existing binding', async () => {
  const monitor = createMonitor({ credentials: store(), fetchImpl: async () => new Response('sensitive secret body', { status: 401 }) });
  await assert.rejects(monitor.configure({ baseUrl: 'https://other.test', adminKey: 'wrong-key' }), code('AUTH_FAILED'));
  assert.equal((await monitor.status()).baseUrl, baseUrl);
});
test('credential rotation changes cache identity', async () => {
  const credentials = store(); let calls = 0;
  const monitor = createMonitor({ credentials, fetchImpl: async () => { calls++; return ok(fixture()); } });
  await monitor.query(range);
  await credentials.modifyRecord(RECORD_KEY, async () => ({ kind: 'grant', payload: { baseUrl, adminKey: 'rotated' } }));
  await monitor.query(range); assert.equal(calls, 2);
});
test('upstream errors are bounded and never echo bodies or fetch exceptions', async () => {
  for (const [status, expected] of [[401, 'AUTH_FAILED'], [403, 'FORBIDDEN'], [404, 'NOT_SUPPORTED'], [405, 'NOT_SUPPORTED'], [500, 'UPSTREAM_ERROR']]) {
    const monitor = createMonitor({ credentials: store(), fetchImpl: async () => new Response('secret-body', { status }) });
    await assert.rejects(monitor.query(range), e => { code(expected)(e); assert.ok(!e.message.includes('secret-body')); return true; });
  }
  const monitor = createMonitor({ credentials: store(), fetchImpl: async () => { throw new Error('secret-key in URL'); } });
  await assert.rejects(monitor.query(range), e => { assert.deepEqual(publicError(e), { code: 'NETWORK_ERROR', message: 'Cannot reach CPAMP. Check the URL, network and TLS certificate.' }); return true; });
  assert.ok(!publicError(new Error('secret')).message.includes('secret'));
});
test('HTML responses, malformed JSON, and huge bodies fail safely', async () => {
  for (const response of [new Response('<html>login</html>'), new Response('{bad', { headers: { 'content-type': 'application/json' } }), new Response(' '.repeat(4 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } })]) {
    const monitor = createMonitor({ credentials: store(), fetchImpl: async () => response });
    await assert.rejects(monitor.query(range), code('INVALID_RESPONSE'));
  }
});
test('timeout and unload cancellation propagate to outbound requests', async () => {
  const lifetime = new AbortController();
  const monitor = createMonitor({ credentials: store(), signal: lifetime.signal, fetchImpl: async (_url, options) => {
    lifetime.abort(); assert.equal(options.signal.aborted, true); throw options.signal.reason;
  } });
  await assert.rejects(monitor.query(range), code('TIMEOUT'));
});
test('storage failures are actionable without leaking provider errors', async () => {
  const credentials = store(); credentials.readRecord = async () => { throw new Error('secret path'); };
  await assert.rejects(createMonitor({ credentials }).status(), code('STORAGE_ERROR'));
});
test('Host route restricts owners, JSON and operation allowlist; tool shares status query only', async () => {
  let route, tool; const disposers = [];
  const peer = { principal: { kind: 'owner' }, signal: new AbortController().signal };
  const ctx = { credentials: store(null), effect(fn) { const dispose = fn(); if (dispose) disposers.push(dispose); },
    connection: { admit: () => ({ peer }), fetch: { register(value) { route = value; return () => {}; } } },
    tools: { register(value) { tool = value; return () => {}; } } };
  apply(ctx); assert.equal(route.path, '/api/cpamp-monitor'); assert.deepEqual(route.methods, ['POST']);
  const post = async (value, headers = { 'content-type': 'application/json' }) => route.fetch(new Request('http://localhost/api/cpamp-monitor', { method: 'POST', headers, body: JSON.stringify(value) }));
  const result = await (await post({ action: 'status' })).json(); assert.equal(result.ok, true); assert.equal(result.value.configured, false);
  assert.deepEqual(await tool.execute({ action: 'status' }, { signal: peer.signal }), result.value);
  assert.equal((await post({ action: 'status' }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post({ action: 'status' }, { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await (await post({ action: 'delete-all' })).json()).error.code, 'INVALID_INPUT');
  await assert.rejects(tool.execute({ action: 'configure', adminKey: 'forbidden' }, { signal: peer.signal }), code('INVALID_INPUT'));
  peer.principal = { kind: 'api' }; assert.equal((await post({ action: 'status' })).status, 403);
  for (const dispose of disposers.reverse()) await dispose(); assert.equal(peer.signal.aborted, false);
});
