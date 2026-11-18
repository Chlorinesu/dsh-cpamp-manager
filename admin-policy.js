/**
 * CPA-Manager-Plus v1.14.10 human-only administration bridge policy.
 * This is deliberately NOT the Manager Server's broad /v0/management proxy.
 * Sources: apps/web/src/services/api/{client,usageService,providers,authFiles,
 * plugins,oauth,config,configFile,logs,apiKeys,apiKeyUsage,vertex,version}.ts;
 * apps/web/src/features/system/managerUpdateApi.ts and Manager Server router.
 *
 * This function classifies only method/path/query. The caller MUST separately
 * authenticate the Harness owner, bind the saved server/key, validate bodies,
 * limit transport size, strip browser Authorization, and enforce confirmation.
 * In particular POST /api-call MUST receive its own fixed URL/method/body policy.
 * Do not make this administration bridge available through an Agent tool.
 */
const PREFIX = '/v0/management';
export const READ_ONLY_POST_PATHS = Object.freeze([
  '/v0/management/monitoring/analytics',
  '/v0/management/monitoring/account-window-usage',
  '/v0/management/quota-snapshots/query',
  '/v0/management/usage/archives/preview',
  '/v0/management/cpa-connection/validate',
]);
// account-history is read-only only when its JSON body has catch_up !== true.
// Its conservative path-only classification is intentional.
export const BODY_DEPENDENT_POST_PATHS = Object.freeze(['/v0/management/monitoring/account-history']);
export const OAUTH_GET_EFFECT_PATH_PATTERN = /^\/v0\/management\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}-auth-url$/;
const routes = new Map();
const add = (path, methods, query = [], options = {}) => {
  routes.set(path, { methods: new Set(methods.split(' ')), query: new Set(query), ...options });
};
const management = (path, methods, query, options) => add(PREFIX + path, methods, query, options);

// Core CPA configuration and credentials (the owner UI may display provider keys).
management('/config', 'GET');
management('/config.yaml', 'GET PUT');
for (const section of ['gemini-api-key', 'interactions-api-key', 'codex-api-key', 'xai-api-key', 'meta-api-key', 'claude-api-key', 'vertex-api-key']) {
  management('/' + section, 'GET PUT DELETE', ['api-key', 'base-url']);
}
management('/openai-compatibility', 'GET PUT DELETE', ['name']);
management('/api-keys', 'GET PUT PATCH DELETE', ['index', 'value']);
management('/api-key-usage', 'GET');
management('/auth-files', 'GET POST DELETE', ['name', 'auth_index']);
management('/auth-files/status', 'PATCH');
management('/auth-files/fields', 'PATCH');
management('/auth-files/download', 'GET', ['name'], { confirmRead: true, reason: 'sensitive-credential-download' });
management('/auth-files/models', 'GET', ['name']);
management('/oauth-excluded-models', 'GET PUT PATCH DELETE', ['provider']);
management('/oauth-model-alias', 'GET PATCH DELETE', ['channel']);
management('/reset-quota', 'POST');
management('/vertex/import', 'POST');
for (const path of ['/debug', '/request-retry', '/quota-exceeded/switch-project', '/quota-exceeded/switch-preview-model', '/request-log', '/logging-to-file', '/ws-auth']) management(path, 'PUT');
management('/proxy-url', 'PUT DELETE');
for (const path of ['/logs-max-total-size-mb', '/force-model-prefix', '/routing/strategy']) management(path, 'GET PUT');
management('/logs', 'GET DELETE', ['after', 'cursor', 'limit']);
management('/request-error-logs', 'GET');
management('/latest-version', 'GET');
management('/get-auth-status', 'GET', ['state']);
management('/oauth-callback', 'POST');
management('/oauth-session', 'DELETE', ['state']);
management('/plugins', 'GET');
management('/plugin-store', 'GET');
management('/api-call', 'POST', [], { reason: 'restricted-external-api-call' });

// CPAMP Full Mode endpoints (not all are under /v0/management).
// Manager Server explicitly owns these same-bound-server model-list routes.
add('/v1/models', 'GET');
add('/models', 'GET');
// The source forwards this v8 configuration view read-only. Do not allow v8
// writes or its generic subtree; child group endpoints need separate review.
add('/v8/management/config/api-keys', 'GET');
add('/status', 'GET', ['scope']);
add('/setup', 'POST');
add('/usage-service/info', 'GET');
add('/usage-service/config', 'GET PUT');
add('/usage-service/account-processing-policy', 'GET PATCH');
add('/usage-service/quota-cooldowns', 'GET');
add('/usage-service/quota-cooldowns/recover', 'POST');
add('/usage-service/updates', 'GET');
for (const suffix of ['/check', '/notification', '/dismiss']) add('/usage-service/updates' + suffix, 'POST');
add('/usage-service/updates/channel', 'PUT');
management('/cpa-connection/validate', 'POST', [], { semanticRead: true });
management('/usage', 'GET');
management('/usage/export', 'GET');
management('/usage/import', 'POST');
management('/usage/import-sessions', 'GET POST', ['status', 'limit', 'cursor']);
management('/usage/archives', 'GET POST', ['status', 'mode', 'limit', 'cursor']);
management('/usage/archives/preview', 'POST', [], { semanticRead: true });
management('/usage/maintenance', 'GET HEAD');
management('/model-prices', 'GET PUT');
management('/model-prices/usage-summary', 'GET');
management('/model-prices/runtime-models', 'GET');
management('/model-prices/sync', 'POST');
management('/api-key-aliases', 'GET PUT');
management('/account-action-candidates', 'GET', ['status', 'limit']);
management('/codex-inspection/run', 'POST');
management('/codex-inspection/runs', 'GET', ['limit']);
management('/dashboard/summary', 'GET', ['today_start_ms', 'now_ms', 'top_models', 'recent_failures']);
management('/monitoring/header-snapshots', 'GET', ['days', 'limit']);
management('/monitoring/analytics', 'POST', [], { semanticRead: true });
management('/monitoring/account-window-usage', 'POST', [], { semanticRead: true });
// account-history with catch_up:true persists derived data. With no body argument
// here, classify conservatively; caller may inspect body and use a narrower flow.
management('/monitoring/account-history', 'POST', [], { reason: 'account-history-may-catch-up' });
management('/quota-snapshots', 'POST');
management('/quota-snapshots/query', 'POST', [], { semanticRead: true });

const dynamic = [
  // Positive int64 database IDs; enforce integer upper bound after regex matching.
  { pattern: /^\/v0\/management\/codex-inspection\/runs\/([1-9][0-9]{0,18})$/, methods: 'GET', id: true },
  { pattern: /^\/v0\/management\/codex-inspection\/runs\/([1-9][0-9]{0,18})\/(actions|cancel)$/, methods: 'POST', id: true },
  { pattern: /^\/v0\/management\/account-action-candidates\/([1-9][0-9]{0,18})\/(ignore|resolve|enable)$/, methods: 'POST', id: true },
  { pattern: /^\/v0\/management\/account-action-candidates\/([1-9][0-9]{0,18})\/auth-file$/, methods: 'DELETE', id: true },
  { pattern: /^\/v0\/management\/api-key-aliases\/[a-fA-F0-9]{64}$/, methods: 'DELETE' },
  // Server generates archive/import IDs with 16 random bytes -> 32 lowercase hex.
  { pattern: /^\/v0\/management\/usage\/archives\/[a-f0-9]{32}$/, methods: 'GET' },
  { pattern: /^\/v0\/management\/usage\/archives\/[a-f0-9]{32}\/(resume|verify|delete|cancel)$/, methods: 'POST', query: ['expected_stage', 'background', 'wait'] },
  { pattern: /^\/v0\/management\/usage\/import-sessions\/[a-f0-9]{32}$/, methods: 'GET DELETE' },
  { pattern: /^\/v0\/management\/usage\/import-sessions\/[a-f0-9]{32}\/chunk$/, methods: 'PUT', query: ['offset'] },
  { pattern: /^\/v0\/management\/usage\/import-sessions\/[a-f0-9]{32}\/(validate|complete)$/, methods: 'POST' },
  // Single opaque name only: never a path, URL, traversal segment, or resource.
  { pattern: /^\/v0\/management\/plugins\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, methods: 'DELETE' },
  { pattern: /^\/v0\/management\/plugins\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/enabled$/, methods: 'PATCH' },
  { pattern: /^\/v0\/management\/plugins\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/config$/, methods: 'GET PUT PATCH' },
  { pattern: /^\/v0\/management\/plugin-store\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/install$/, methods: 'POST', query: ['source', 'version'] },
  { pattern: /^\/v0\/management\/model-definitions\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, methods: 'GET' },
  // OAuth provider is extensible in upstream UI, but always a safe single token.
  { pattern: /^\/v0\/management\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}-auth-url$/, methods: 'GET', query: ['is_webui'], confirmRead: true, reason: 'oauth-session-start' },
  { pattern: /^\/v0\/management\/request-error-logs\/[A-Za-z0-9_][A-Za-z0-9_. -]{0,254}$/, methods: 'GET' },
  { pattern: /^\/v0\/management\/request-log-by-id\/[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/, methods: 'GET' },
];
const rejected = reason => ({ allowed: false, requiresConfirmation: false, reason });

export function classifyAdminRequest(method, pathWithQuery) {
  if (typeof method !== 'string' || !/^(GET|HEAD|POST|PUT|PATCH|DELETE)$/.test(method)) return rejected('unsupported-method');
  if (typeof pathWithQuery !== 'string' || pathWithQuery.length > 10240 || !pathWithQuery.startsWith('/') || pathWithQuery.startsWith('//') || /[\\#\u0000-\u001f\u007f]/.test(pathWithQuery)) return rejected('invalid-path');
  const question = pathWithQuery.indexOf('?');
  const rawPath = question < 0 ? pathWithQuery : pathWithQuery.slice(0, question);
  const rawQuery = question < 0 ? '' : pathWithQuery.slice(question + 1);
  if (rawPath.length > 2048 || rawQuery.length > 8192 || /\s/.test(rawPath) || rawPath.includes('//')) return rejected('invalid-path');
  // Do not let WHATWG URL/Go routing normalize a path after policy inspection.
  // Percent encoded dots are rejected even when they could be a literal filename.
  if (/%(?:2f|5c|2e|25)/i.test(rawPath) || /%(?![0-9a-fA-F]{2})/.test(rawPath + rawQuery)) return rejected('encoded-path');
  let path;
  try { path = decodeURIComponent(rawPath); decodeURIComponent(rawQuery.replace(/\+/g, ' ')); } catch { return rejected('invalid-encoding'); }
  if (path.includes('..') || path.includes('//') || /[\\\u0000-\u001f\u007f]/.test(path) || path.split('/').some(segment => segment === '.')) return rejected('unsafe-path');
  // Upstream handlers accept a trailing slash. Canonicalize exactly one, not //.
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  let rule = routes.get(path);
  if (!rule) {
    for (const candidate of dynamic) {
      const match = path.match(candidate.pattern);
      if (!match) continue;
      if (candidate.id && BigInt(match[1]) > 9223372036854775807n) return rejected('invalid-id');
      rule = { ...candidate, methods: new Set(candidate.methods.split(' ')), query: new Set(candidate.query ?? []) };
      break;
    }
  }
  if (!rule || !rule.methods.has(method)) return rejected('endpoint-not-allowed');
  const params = new URLSearchParams(rawQuery);
  const seen = new Set();
  for (const [key, value] of params) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || !rule.query.has(key) || seen.has(key) || /[\u0000-\u001f\u007f]/.test(value)) return rejected('query-not-allowed');
    seen.add(key);
  }
  const requiresConfirmation = rule.confirmRead === true || (!['GET', 'HEAD'].includes(method) && !rule.semanticRead);
  return { allowed: true, requiresConfirmation, ...(requiresConfirmation ? { reason: rule.reason ?? 'remote-write' } : {}) };
}

/** Fixed provider helpers used by quota/subscription reads in v1.14.10. */
export const READ_ONLY_API_HELPER_URLS = Object.freeze([
  ['GET', 'https://chatgpt.com/backend-api/wham/usage'],
  ['GET', 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'],
  ['GET', 'https://api.anthropic.com/api/oauth/profile'],
  ['GET', 'https://api.anthropic.com/api/oauth/usage'],
  ['GET', 'https://api.kimi.com/coding/v1/usages'],
  ['GET', 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'],
  ['GET', 'https://cli-chat-proxy.grok.com/v1/billing'],
  ['GET', 'https://api.x.ai/v1/me'],
  ['GET', 'https://cli-chat-proxy.grok.com/v1/user?include=subscription'],
  ['GET', 'https://cli-chat-proxy.grok.com/v1/settings'],
  ['POST', 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary'],
  ['POST', 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary'],
  ['POST', 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary'],
  ['POST', 'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels'],
  ['POST', 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels'],
  ['POST', 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels'],
  ['POST', 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'],
  ['POST', 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'],
  ['POST', 'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus'],
  ['POST', 'https://api.meta.ai/muse-code/key'],
].map(item => Object.freeze(item)));
const readHelperPairs = new Set(READ_ONLY_API_HELPER_URLS.map(([method, url]) => method + ' ' + url));
const helperHeaders = new Set(['authorization', 'accept', 'content-type', 'user-agent', 'chatgpt-account-id', 'openai-beta', 'originator', 'anthropic-beta', 'x-api-version', 'connect-protocol-version', 'x-xai-token-auth', 'x-grok-client-version', 'x-userid']);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const onlyKeys = (value, keys) => plainObject(value) && Object.keys(value).every(key => keys.includes(key));

/**
 * A boolean exemption for the outer POST /api-call confirmation only. It is
 * NOT a general forwarding grant. The caller must still authenticate the owner,
 * bind the CPAMP server, cap bytes, and never return the stored management key.
 * Unknown/custom provider origins, inference probes, credit redemption, proxy
 * overrides, changed methods/bodies and transport-control headers remain writes
 * or unsupported and MUST NOT silently receive this exemption.
 */
export function isReadOnlyApiHelper(payload) {
  if (!onlyKeys(payload, ['authIndex', 'method', 'url', 'header', 'data', 'proxy_url', 'proxyUrl'])) return false;
  if (typeof payload.authIndex !== 'string' || !payload.authIndex.trim() || payload.authIndex.length > 512 || /[\u0000-\u001f\u007f]/.test(payload.authIndex)) return false;
  if (payload.proxy_url || payload.proxyUrl || !readHelperPairs.has(payload.method + ' ' + payload.url)) return false;
  if (payload.header !== undefined) {
    if (!plainObject(payload.header) || Object.keys(payload.header).length > 20) return false;
    for (const [name, value] of Object.entries(payload.header)) if (!helperHeaders.has(name.toLowerCase()) || typeof value !== 'string' || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  }
  if (payload.method === 'GET') return payload.data === undefined || payload.data === null || payload.data === '';
  if (typeof payload.data !== 'string' || payload.data.length > 65536) return false;
  let body;
  try { body = JSON.parse(payload.data); } catch { return false; }
  if (payload.url.endsWith(':retrieveUserQuotaSummary') || payload.url.endsWith(':fetchAvailableModels')) {
    return onlyKeys(body, ['project']) && Object.keys(body).length === 1 && typeof body.project === 'string' && body.project.length > 0 && body.project.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(body.project);
  }
  if (payload.url.endsWith(':loadCodeAssist')) return onlyKeys(body, ['metadata']) && onlyKeys(body.metadata, ['ideType']) && body.metadata.ideType === 'ANTIGRAVITY';
  if (payload.url === 'https://api.meta.ai/muse-code/key') return onlyKeys(body, []) && Object.keys(body).length === 0;
  if (payload.url === 'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus') {
    return onlyKeys(body, ['metadata']) && onlyKeys(body.metadata, ['ideName', 'ideVersion', 'apiKey', 'locale', 'os', 'extensionVersion', 'clientName']) && body.metadata.apiKey === '$TOKEN$' && Object.values(body.metadata).every(value => typeof value === 'string' && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value));
  }
  return false;
}
