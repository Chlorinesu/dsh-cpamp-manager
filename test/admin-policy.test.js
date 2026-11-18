import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAdminRequest as classify, READ_ONLY_POST_PATHS, BODY_DEPENDENT_POST_PATHS, OAUTH_GET_EFFECT_PATH_PATTERN, READ_ONLY_API_HELPER_URLS, isReadOnlyApiHelper } from '../admin-policy.js';
const P = '/v0/management';
const allow = (method, path, confirm = false) => { const result = classify(method, path); assert.equal(result.allowed, true, `${method} ${path}: ${result.reason}`); assert.equal(result.requiresConfirmation, confirm, `${method} ${path}`); };
const deny = (method, path) => assert.equal(classify(method, path).allowed, false, `${method} ${path}`);

test('fixed CPA provider/configuration routes match actual web client methods', () => {
  allow('GET', P + '/config'); deny('PUT', P + '/config');
  allow('GET', P + '/config.yaml'); allow('PUT', P + '/config.yaml', true);
  for (const name of ['gemini-api-key', 'interactions-api-key', 'codex-api-key', 'xai-api-key', 'meta-api-key', 'claude-api-key', 'vertex-api-key']) {
    allow('GET', `${P}/${name}`); allow('PUT', `${P}/${name}`, true);
    allow('DELETE', `${P}/${name}?api-key=example-key&base-url=https%3A%2F%2Fprovider.test%2Fv1`, true);
    deny('PATCH', `${P}/${name}`);
  }
  allow('GET', P + '/openai-compatibility'); allow('PUT', P + '/openai-compatibility', true); allow('DELETE', P + '/openai-compatibility?name=example', true);
});
test('core fixed write operations require confirmation', () => {
  for (const [method, path] of [
    ['PUT', '/debug'], ['PUT', '/proxy-url'], ['DELETE', '/proxy-url'], ['PUT', '/request-retry'], ['PUT', '/quota-exceeded/switch-project'], ['PUT', '/quota-exceeded/switch-preview-model'], ['PUT', '/request-log'], ['PUT', '/logging-to-file'], ['PUT', '/ws-auth'], ['PUT', '/logs-max-total-size-mb'], ['PUT', '/force-model-prefix'], ['PUT', '/routing/strategy'], ['PUT', '/api-keys'], ['PATCH', '/api-keys'], ['DELETE', '/api-keys?index=0'], ['DELETE', '/api-keys?value=example'], ['PATCH', '/auth-files/status'], ['PATCH', '/auth-files/fields'], ['POST', '/reset-quota'], ['POST', '/vertex/import'], ['DELETE', '/logs'], ['POST', '/api-call'],
  ]) allow(method, P + path, true);
});
test('Full Mode paths are not accidentally prefixed with /v0/management', () => {
  for (const path of ['/status', '/status?scope=database-maintenance', '/usage-service/info', '/usage-service/config', '/usage-service/account-processing-policy', '/usage-service/quota-cooldowns', '/usage-service/updates']) allow('GET', path);
  for (const [method, path] of [['POST', '/setup'], ['PUT', '/usage-service/config'], ['PATCH', '/usage-service/account-processing-policy'], ['POST', '/usage-service/quota-cooldowns/recover'], ['POST', '/usage-service/updates/check'], ['POST', '/usage-service/updates/notification'], ['POST', '/usage-service/updates/dismiss'], ['PUT', '/usage-service/updates/channel']]) allow(method, path, true);
  deny('GET', P + '/usage-service/info'); deny('POST', '/usage-service/collector/run');
});
test('semantic read-only POSTs and body-dependent catch-up are explicit', () => {
  for (const path of READ_ONLY_POST_PATHS) allow('POST', path);
  for (const path of BODY_DEPENDENT_POST_PATHS) allow('POST', path, true);
  allow('POST', P + '/quota-snapshots', true);
  deny('POST', P + '/account-quota-snapshots/query');
  deny('GET', P + '/monitoring/analytics');
});
test('OAuth session starts are side-effecting GETs, not ordinary reads', () => {
  for (const provider of ['codex', 'anthropic', 'antigravity', 'kimi', 'xai', 'devin', 'meta', 'plugin-provider']) {
    const path = `${P}/${provider}-auth-url`;
    assert.ok(OAUTH_GET_EFFECT_PATH_PATTERN.test(path)); allow('GET', path, true);
    allow('GET', path + '?is_webui=true', true);
    deny('POST', path);
  }
  allow('GET', P + '/get-auth-status?state=opaque-state');
  allow('POST', P + '/oauth-callback', true); allow('DELETE', P + '/oauth-session?state=opaque-state', true);
});
test('auth file uploads, metadata and sensitive downloads are distinct', () => {
  allow('GET', P + '/auth-files?name=account.json&auth_index=123');
  allow('POST', P + '/auth-files', true); allow('DELETE', P + '/auth-files?name=runtime-1', true);
  allow('GET', P + '/auth-files/models?name=account.json');
  allow('GET', P + '/auth-files/download?name=account.json', true);
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const supported = method !== 'PUT';
    if (supported) allow(method, P + '/oauth-model-alias' + (method === 'DELETE' ? '?channel=codex' : ''), method !== 'GET');
    else deny(method, P + '/oauth-model-alias');
  }
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) allow(method, P + '/oauth-excluded-models', method !== 'GET');
});
test('positive numeric database IDs never become arbitrary subpaths', () => {
  allow('GET', P + '/codex-inspection/runs/123');
  allow('POST', P + '/codex-inspection/runs/123/actions', true); allow('POST', P + '/codex-inspection/runs/123/cancel', true);
  for (const action of ['ignore', 'resolve', 'enable']) allow('POST', P + '/account-action-candidates/123/' + action, true);
  allow('DELETE', P + '/account-action-candidates/123/auth-file', true);
  for (const id of ['0', '-1', '1.1', '1e3', '001', '9223372036854775808', 'abc']) deny('GET', P + '/codex-inspection/runs/' + id);
  deny('POST', P + '/codex-inspection/runs/1/actions/cancel');
});
test('archive and import session IDs match server-generated 32 lowercase hex', () => {
  const id = '0123456789abcdef0123456789abcdef';
  allow('GET', P + '/usage/archives?limit=20&status=completed&mode=archive&cursor=opaque');
  allow('POST', P + '/usage/archives', true); allow('GET', P + '/usage/archives/' + id);
  for (const action of ['resume', 'verify', 'delete', 'cancel']) allow('POST', P + '/usage/archives/' + id + '/' + action + '?background=true&expected_stage=verify', true);
  allow('GET', P + '/usage/import-sessions?limit=20&cursor=opaque&status=ready');
  allow('POST', P + '/usage/import-sessions', true);
  allow('GET', P + '/usage/import-sessions/' + id); allow('DELETE', P + '/usage/import-sessions/' + id, true);
  allow('PUT', P + '/usage/import-sessions/' + id + '/chunk?offset=4194304', true);
  for (const action of ['validate', 'complete']) allow('POST', P + '/usage/import-sessions/' + id + '/' + action, true);
  for (const invalid of [id.toUpperCase(), id.slice(1), 'run/id', 'run-id']) { deny('GET', P + '/usage/archives/' + invalid); deny('GET', P + '/usage/import-sessions/' + invalid); }
  allow('HEAD', P + '/usage/maintenance'); allow('GET', P + '/usage/maintenance'); deny('POST', P + '/usage/maintenance');
});
test('safe dynamic plugin/model/log identifiers allow only reviewed operations', () => {
  allow('GET', P + '/plugins'); allow('GET', P + '/plugin-store');
  allow('GET', P + '/plugins/example-plugin/config'); allow('PUT', P + '/plugins/example-plugin/config', true); allow('PATCH', P + '/plugins/example-plugin/config', true);
  allow('PATCH', P + '/plugins/example-plugin/enabled', true); allow('DELETE', P + '/plugins/example-plugin', true);
  allow('POST', P + '/plugin-store/example-plugin/install?source=official&version=v1.0.0', true);
  allow('GET', P + '/model-definitions/gemini'); allow('GET', P + '/request-error-logs/error-2026-11-18.log'); allow('GET', P + '/request-log-by-id/abc-def-123');
  allow('DELETE', P + '/api-key-aliases/' + 'a'.repeat(64), true); deny('DELETE', P + '/api-key-aliases/unknown');
  deny('POST', P + '/plugins/example-plugin/config'); deny('GET', P + '/plugins/example-plugin/execute');
});
test('known monitoring query parameters are accepted, unknown query keys fail closed', () => {
  allow('GET', P + '/dashboard/summary?today_start_ms=123&now_ms=456&top_models=5&recent_failures=5');
  allow('GET', P + '/monitoring/header-snapshots?days=7&limit=100');
  allow('GET', P + '/logs?after=123&cursor=opaque%2Ftoken&limit=100');
  deny('GET', P + '/config?target=https%3A%2F%2Fevil.test');
  deny('GET', P + '/logs?limit=100&limit=50000');
  deny('GET', P + '/logs?=empty'); deny('GET', P + '/logs?limit=%00');
  deny('GET', P + '/logs?cursor=' + 'x'.repeat(8193));
});
test('reject absolute URLs, scheme-relative paths, fragments and unsupported verbs', () => {
  for (const path of ['https://server.test' + P + '/config', '//server.test' + P + '/config', '/\\server.test' + P + '/config', P + '/config#fragment', P + '/config\n', P + '/config\0']) deny('GET', path);
  for (const method of ['get', 'OPTIONS', 'CONNECT', 'TRACE', '', null]) deny(method, P + '/config');
});
test('reject path traversal, encoded separators/dots and double encoded paths', () => {
  for (const path of [P + '/../config', P + '/./config', P + '//config', P + '/plugins/../config', P + '/plugins/%2e%2e/config', P + '/plugins/%252e%252e/config', P + '/plugins/a%2fb/config', P + '/plugins/a%5cb/config', P + '/plugins/a%252fb/config', P + '/plugins/a\\b/config', P + '/plugins/a%00b/config', P + '/plugins/%zz/config']) deny('GET', path);
  allow('GET', P + '/config/');
});
test('bound-server model routes and exact read-only v8 key view are allowed', () => {
  for (const path of ['/v1/models', '/models', '/v8/management/config/api-keys']) {
    allow('GET', path); allow('GET', path + '/');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) deny(method, path);
  }
  deny('GET', '/v8/management/config/api-keys/unknown');
});
test('fixed quota helper pairs are read-only only with reviewed request bodies', () => {
  for (const [method, url] of READ_ONLY_API_HELPER_URLS) {
    let data;
    if (method === 'POST') {
      if (url.endsWith(':loadCodeAssist')) data = JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } });
      else if (url.includes('GetUserStatus')) data = JSON.stringify({ metadata: { ideName: 'chisel', apiKey: '$TOKEN$', locale: 'en' } });
      else if (url.includes('muse-code')) data = '{}';
      else data = JSON.stringify({ project: 'example-project' });
    }
    assert.equal(isReadOnlyApiHelper({ authIndex: '123', method, url, ...(data ? { data } : {}), header: { Authorization: 'Bearer $TOKEN$', 'Content-Type': 'application/json' } }), true, method + ' ' + url);
  }
});
test('quota helper exemptions never permit inference, credits consume, arbitrary destinations or method override', () => {
  const payload = { authIndex: '123', method: 'GET', url: 'https://chatgpt.com/backend-api/wham/usage' };
  const denied = [
    { ...payload, url: 'http://chatgpt.com/backend-api/wham/usage' },
    { ...payload, url: 'https://chatgpt.com.evil.test/backend-api/wham/usage' },
    { ...payload, url: 'https://user:pass@chatgpt.com/backend-api/wham/usage' },
    { ...payload, url: 'https://chatgpt.com/backend-api/wham/usage?target=evil' },
    { ...payload, method: 'POST' }, { ...payload, data: '{}' },
    { ...payload, proxy_url: 'http://evil.test' }, { ...payload, proxyUrl: 'socks5://evil.test' },
    { ...payload, header: { Host: 'evil.test' } }, { ...payload, header: { 'X-HTTP-Method-Override': 'DELETE' } },
    { ...payload, header: { Authorization: 'Bearer value\r\nBad: header' } },
    { ...payload, followRedirects: true }, { ...payload, authIndex: '' },
    { ...payload, method: 'POST', url: 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume', data: '{}' },
    { ...payload, method: 'POST', url: 'https://api.x.ai/v1/responses', data: '{"model":"grok","input":"OK"}' },
    { ...payload, method: 'GET', url: 'https://provider.test/v1/models' },
    { ...payload, method: 'POST', url: 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', data: '{"metadata":{"ideType":"ANTIGRAVITY"},"action":"mutate"}' },
    { ...payload, method: 'POST', url: 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', data: '{"project":"example","delete":true}' },
    { ...payload, method: 'POST', url: 'https://api.meta.ai/muse-code/key', data: '{"mutate":true}' },
    { ...payload, method: 'POST', url: 'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus', data: '{"metadata":{"apiKey":"$TOKEN$","action":"mutate"}}' },
  ];
  for (const value of denied) assert.equal(isReadOnlyApiHelper(value), false);
  for (const value of [null, undefined, 'bad', []]) assert.equal(isReadOnlyApiHelper(value), false);
});
test('never inherit Manager Server broad prefix fallback or expose queue/resource APIs', () => {
  for (const path of [P + '/unknown', P + '/usage-events', P + '/usage/unknown', P + '/usage/unknown/export', P + '/collector', P + '/reload', '/v0/resource/plugins/example/index.html', '/health', '/management.html']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) deny(method, path);
  }
});
