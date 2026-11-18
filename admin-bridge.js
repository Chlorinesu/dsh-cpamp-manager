import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { RECORD_KEY, normalizeBaseUrl, MonitorError, publicError } from './monitor.js';
import { classifyAdminRequest, isReadOnlyApiHelper } from './admin-policy.js';

export const ADMIN_BRIDGE_PATH = '/api/cpamp-admin/bridge';
export const PUBLIC_RELEASE_PATH = '/api/cpamp-admin/public-release';
const RELEASE_URL = 'https://raw.githubusercontent.com/seakee/CPA-Manager-Plus/update-channel/update-index.json';
const MAX_REQUEST = 128 * 1024 * 1024;
const MAX_RESPONSE = 256 * 1024 * 1024;
const reject = (code, message) => { throw new MonitorError(code, message); };
const responseHeaders = source => {
  const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
  for (const key of ['content-type', 'content-disposition', 'etag', 'last-modified', 'x-cpa-version', 'x-server-version', 'x-cpa-commit', 'x-server-commit', 'x-cpa-build-date', 'x-server-build-date', 'x-cpa-support-plugin']) {
    const value = source.get(key); if (value !== null) headers.set(key, value);
  }
  return headers;
};
const jsonError = (error, status = 400) => new Response(JSON.stringify({ error: publicError(error).message, code: publicError(error).code }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
export function isPrivateAddress(address) {
  if (address.includes(':')) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return true;
    return !/^[23]/.test(lower) || lower.startsWith('2001:db8:') || lower.startsWith('2001:0:') || lower.startsWith('3fff:');
  }
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
}
export async function validateApiHelper(payload, binding, lookupImpl = lookup) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) reject('INVALID_INPUT', 'API helper expects a JSON object.');
  const method = String(payload.method ?? 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) reject('FORBIDDEN', 'The API helper only supports confirmed provider queries and tests.');
  let url; try { url = new URL(payload.url); } catch { reject('INVALID_INPUT', 'The provider test URL is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname || url.hostname.toLowerCase() === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) reject('FORBIDDEN', 'Provider tests require a public HTTPS URL without embedded credentials.');
  const base = new URL(binding.baseUrl);
  if (url.host === base.host && (/\/(?:v0\/management|usage-service)(?:\/|$)/.test(url.pathname) || ['/setup', '/status'].includes(url.pathname))) reject('FORBIDDEN', 'The provider helper cannot call management endpoints.');
  if (url.port && url.port !== '443') reject('FORBIDDEN', 'Provider helper requests require the standard HTTPS port.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookupImpl(hostname, { all: true });
  if (!addresses.length || addresses.some(row => isPrivateAddress(row.address))) reject('FORBIDDEN', 'Provider helper requests to private or reserved networks are not allowed.');
  // The real CPAMP Admin Key is exclusively an outer request credential.
  if (payload.header !== undefined && (!payload.header || typeof payload.header !== 'object' || Array.isArray(payload.header))) reject('INVALID_INPUT', 'Provider helper headers must be an object.');
  for (const [name, value] of Object.entries(payload.header ?? {})) {
    if (/^(host|cookie|set-cookie|proxy-authorization|connection|transfer-encoding|content-length|x-http-method-override)$/i.test(name) || typeof value !== 'string' || /[\r\n\u0000]/.test(value)) reject('FORBIDDEN', 'Provider helper transport-control headers are not allowed.');
  }
  const serialized = JSON.stringify(payload);
  if (binding.adminKey && serialized.includes(binding.adminKey)) reject('FORBIDDEN', 'The CPAMP Admin Key cannot be forwarded as a provider credential.');
  if (serialized.length > 2 * 1024 * 1024) reject('INVALID_INPUT', 'Provider helper payload is too large.');
}
async function readBinding(credentials) {
  let record;
  try { record = await credentials.readRecord(RECORD_KEY); } catch { reject('STORAGE_ERROR', 'Cannot read the saved Harness credential binding.'); }
  const value = record?.kind === 'grant' ? record.payload : null;
  if (!value?.adminKey || typeof value.adminKey !== 'string' || typeof value.baseUrl !== 'string') reject('NOT_CONFIGURED', 'Configure a CPAMP connection first.');
  return { baseUrl: normalizeBaseUrl(value.baseUrl), adminKey: value.adminKey };
}
function safeNetworkError(error, signal) {
  if (error instanceof MonitorError) return error;
  if (signal?.aborted) return new MonitorError('TIMEOUT', 'The CPAMP request timed out or was cancelled.');
  const code = error?.cause?.code ?? error?.code;
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return new MonitorError('NETWORK_DNS', 'The CPAMP server hostname could not be resolved.');
  if (['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET'].includes(code)) return new MonitorError('NETWORK_ERROR', 'The CPAMP connection was refused, reset or unreachable.');
  if (/CERT|TLS|SSL|SELF_SIGNED/.test(String(code ?? ''))) return new MonitorError('TLS_ERROR', 'CPAMP TLS certificate validation failed.');
  return new MonitorError('NETWORK_ERROR', 'The CPAMP request could not be sent. Check the URL, network and credential format.');
}
function boundedStream(body, limit, onDone) {
  if (!body) { onDone(); return null; }
  const reader = body.getReader(); let total = 0;
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) { reader.releaseLock(); onDone(); controller.close(); return; }
        total += result.value.byteLength;
        if (total > limit) { await reader.cancel(); onDone(); controller.error(new Error('CPAMP response exceeds the transfer limit.')); return; }
        controller.enqueue(result.value);
      } catch { onDone(); controller.error(new Error('CPAMP response transfer was interrupted.')); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { onDone(); } },
  });
}
export function createAdminBridge({ credentials, fetchImpl = globalThis.fetch, signal: lifetimeSignal, lookupImpl = lookup }) {
  async function proxy(request) {
    let combined; let timer;
    try {
      const method = (request.headers.get('x-cpamp-method') ?? '').toUpperCase();
      const encodedPath = request.headers.get('x-cpamp-path');
      if (!encodedPath || encodedPath.length > 32768) reject('INVALID_INPUT', 'A valid management operation path is required.');
      let targetPath; try { targetPath = decodeURIComponent(encodedPath); } catch { reject('INVALID_INPUT', 'Invalid encoded management path.'); }
      const policy = classifyAdminRequest(method, targetPath);
      if (!policy.allowed) reject('FORBIDDEN', policy.reason ?? 'This management operation is not available through the Harness bridge.');
      const binding = await readBinding(credentials);
      if (/[^\x21-\x7e]/.test(binding.adminKey)) reject('KEY_INVALID_FORMAT', 'The saved CPAMP Admin Key contains unsupported characters. Re-enter the key in connection settings.');
      const length = Number(request.headers.get('content-length') ?? 0);
      if (Number.isFinite(length) && length > MAX_REQUEST) reject('INVALID_INPUT', 'Upload exceeds the 128 MiB limit.');
      const body = method === 'GET' || method === 'HEAD' ? null : new Uint8Array(await request.arrayBuffer());
      if (body && body.byteLength > MAX_REQUEST) reject('INVALID_INPUT', 'Upload exceeds the 128 MiB limit.');
      let requiresConfirmation = policy.requiresConfirmation;
      if (method === 'POST' && targetPath.split('?')[0] === '/v0/management/monitoring/account-history') {
        let payload; try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { reject('INVALID_INPUT', 'Account history expects a JSON object.'); }
        if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.catch_up !== true) requiresConfirmation = false;
      }
      const isHelper = targetPath.split('?')[0].replace(/\/$/, '') === '/v0/management/api-call';
      if (isHelper) {
        let payload; try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { reject('INVALID_INPUT', 'Provider helper expects a JSON body.'); }
        await validateApiHelper(payload, binding, lookupImpl);
        if (isReadOnlyApiHelper(payload)) requiresConfirmation = false;
      }
      if (requiresConfirmation && request.headers.get('x-cpamp-confirmed') !== '1') reject('CONFIRMATION_REQUIRED', 'Confirm this management operation in the CPAMP interface first.');
      const timeout = new AbortController(); timer = setTimeout(() => timeout.abort(), /backup|restore|import|export|update/.test(targetPath) ? 180000 : 90000);
      combined = AbortSignal.any([request.signal, timeout.signal, ...(lifetimeSignal ? [lifetimeSignal] : [])]);
      const isModelList = method === 'GET' && ['/v1/models', '/models'].includes(targetPath.split('?')[0].replace(/\/$/, ''));
      let authorization = 'Bearer ' + binding.adminKey;
      if (isModelList) {
        const supplied = request.headers.get('x-cpamp-model-authorization') ?? '';
        if (!/^Bearer [\x21-\x7e]+$/.test(supplied) || supplied === authorization || supplied.includes('harness-host-managed-credential')) reject('KEY_REQUIRED', 'Model listing requires a CPA client API key, never the CPAMP Admin Key.');
        authorization = supplied;
      }
      const headers = new Headers({ authorization, accept: request.headers.get('accept') ?? '*/*' });
      const contentType = request.headers.get('content-type'); if (contentType && body?.byteLength) headers.set('content-type', contentType);
      const target = new URL(binding.baseUrl + '/' + targetPath.replace(/^\//, ''));
      const remote = await fetchImpl(target, { method, headers, body: body?.byteLength ? body : undefined, redirect: 'error', signal: combined });
      const outHeaders = responseHeaders(remote.headers);
      if ([204, 205, 304].includes(remote.status) || method === 'HEAD') { await remote.body?.cancel(); clearTimeout(timer); return new Response(null, { status: remote.status, headers: outHeaders }); }
      return new Response(boundedStream(remote.body, MAX_RESPONSE, () => clearTimeout(timer)), { status: remote.status, statusText: remote.statusText, headers: outHeaders });
    } catch (error) { clearTimeout(timer); return jsonError(safeNetworkError(error, combined)); }
  }
  async function release(request) {
    const timeout = AbortSignal.timeout(20000);
    try {
      const remote = await fetchImpl(RELEASE_URL, { method: 'GET', redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.any([request.signal, timeout, ...(lifetimeSignal ? [lifetimeSignal] : [])]) });
      return new Response(boundedStream(remote.body, 1024 * 1024, () => {}), { status: remote.status, headers: responseHeaders(remote.headers) });
    } catch (error) { return jsonError(safeNetworkError(error, timeout)); }
  }
  return { proxy, release };
}
export function registerAdminRoutes(ctx, lifetimeSignal) {
  const service = createAdminBridge({ credentials: ctx.credentials, signal: lifetimeSignal });
  const ownerOnly = handler => async request => {
    const admission = ctx.connection.admit(request);
    if (admission.rejection || admission.peer?.principal.kind !== 'owner' || request.headers.get('sec-fetch-site') === 'cross-site') return jsonError(new MonitorError('FORBIDDEN', 'This management interface is only available to the Harness owner.'), 403);
    return handler(request);
  };
  ctx.effect(() => ctx.connection.fetch.register({ path: ADMIN_BRIDGE_PATH, methods: ['POST'], requestBody: 'buffered', fetch: ownerOnly(service.proxy) }));
  ctx.effect(() => ctx.connection.fetch.register({ path: PUBLIC_RELEASE_PATH, methods: ['GET'], requestBody: 'buffered', fetch: ownerOnly(service.release) }));
}
