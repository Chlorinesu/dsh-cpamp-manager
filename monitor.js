import { createHash } from 'node:crypto';

export const RECORD_KEY = 'cpamp-monitor/connection';
export const DEFAULT_URL = '';
const ENDPOINT = 'v0/management/monitoring/analytics';
const MAX_BODY = 4 * 1024 * 1024;
const MAX_RANGE = 32 * 86400000;
export class MonitorError extends Error {
  constructor(code, message) { super(message); this.name = 'MonitorError'; this.code = code; }
}
const fail = (code, message) => { throw new MonitorError(code, message); };
export function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) fail('INVALID_URL', 'Enter a valid CPAMP server URL.');
  let url;
  try { url = new URL(value.trim()); } catch { fail('INVALID_URL', 'Enter a valid CPAMP server URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) fail('INVALID_URL', 'Use HTTPS, or HTTP on localhost only.');
  if (url.username || url.password || url.search) fail('INVALID_URL', 'Credentials and query parameters must not appear in the server URL.');
  url.hash = '';
  url.pathname = url.pathname.replace(/\/management\.html\/?$/i, '').replace(/\/+$/, '');
  return url.href.replace(/\/$/, '');
}
const numeric = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const count = v => { const n = numeric(v); return n !== null && n >= 0 ? n : null; };
const text = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : '';
const fields = (source, mapping) => Object.fromEntries(Object.entries(mapping).map(([out, key]) => [out, count(source?.[key])]));
const usageFields = { calls: 'total_calls', success: 'success_calls', failure: 'failure_calls', tokens: 'total_tokens', inputTokens: 'input_tokens', outputTokens: 'output_tokens', cachedTokens: 'cached_tokens', cost: 'total_cost' };
function coverageOf(value) {
  return { rawComplete: typeof value?.raw_complete === 'boolean' ? value.raw_complete : null,
    mode: text(value?.mode, 80), limitations: Array.isArray(value?.fidelity_limitations) ? value.fidelity_limitations.filter(x => typeof x === 'string').slice(0, 10).map(x => text(x)) : [] };
}
export function projectResponse(raw, kind) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !numeric(raw.generated_at_ms)) fail('INVALID_RESPONSE', 'CPAMP returned an incompatible analytics response.');
  const coverage = coverageOf(raw.coverage);
  if (kind === 'events') {
    if (!raw.events || (raw.events.items != null && !Array.isArray(raw.events.items))) fail('INVALID_RESPONSE', 'CPAMP did not return the requested records page.');
    return {
      items: (raw.events.items ?? []).slice(0, 50).map(r => ({ atMs: count(r.timestamp_ms), model: text(r.model), tokens: count(r.total_tokens), inputTokens: count(r.input_tokens), outputTokens: count(r.output_tokens), latencyMs: count(r.latency_ms), failed: typeof r.failed === 'boolean' ? r.failed : null, statusCode: count(r.fail_status_code) })),
      nextBeforeMs: count(raw.events.next_before_ms), nextBeforeId: count(raw.events.next_before_id), hasMore: raw.events.has_more === true, totalCount: count(raw.events.total_count), coverage,
    };
  }
  if (!raw.summary || typeof raw.summary !== 'object' || count(raw.summary.total_calls) === null) fail('INVALID_RESPONSE', 'CPAMP did not return the requested summary.');
  for (const key of ['model_stats', 'timeline']) if (raw[key] !== undefined && !Array.isArray(raw[key])) fail('INVALID_RESPONSE', 'CPAMP returned an incompatible analytics response.');
  return {
    generatedAtMs: raw.generated_at_ms, summary: fields(raw.summary, usageFields),
    models: (raw.model_stats ?? []).slice(0, 2000).map(r => ({ model: text(r.model), ...fields(r, { ...usageFields, calls: 'calls', cost: 'cost' }) })),
    timeline: (raw.timeline ?? []).slice(0, 5000).map(r => ({ atMs: count(r.bucket_ms), calls: count(r.calls), tokens: count(r.total_tokens ?? r.tokens), failure: count(r.failure), cost: count(r.cost) })), coverage,
  };
}
export function validateQuery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', 'Invalid monitoring query.');
  const { fromMs, toMs } = input;
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs <= 0 || toMs <= fromMs || toMs - fromMs > MAX_RANGE || toMs > Date.now() + 300000) fail('INVALID_INPUT', 'Choose a valid time range of up to 32 days.');
  const timeZone = input.timeZone ?? 'UTC';
  if (typeof timeZone !== 'string' || timeZone.length > 100) fail('INVALID_INPUT', 'Invalid time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { fail('INVALID_INPUT', 'Use a valid IANA time zone.'); }
  const kind = input.kind ?? 'overview';
  if (!['overview', 'events'].includes(kind)) fail('INVALID_INPUT', 'Invalid monitoring query kind.');
  const cursor = input.beforeMs !== undefined || input.beforeId !== undefined;
  if (cursor && (kind !== 'events' || !Number.isSafeInteger(input.beforeMs) || input.beforeMs <= 0 || !Number.isSafeInteger(input.beforeId) || input.beforeId <= 0)) fail('INVALID_INPUT', 'Both pagination cursors are required.');
  return { fromMs, toMs, timeZone, kind, ...(cursor ? { beforeMs: input.beforeMs, beforeId: input.beforeId } : {}) };
}
function bodyFor(query) {
  const include = query.kind === 'events'
    ? { events_page: { limit: 50, ...(query.beforeMs ? { before_ms: query.beforeMs, before_id: query.beforeId } : {}) } }
    : { summary: true, summary_profile: 'compact', timeline: true, model_stats: true };
  return { from_ms: query.fromMs, to_ms: query.toMs, time_zone: query.timeZone, filters: { include_failed: true }, include };
}
function bindingOf(record) {
  const p = record?.kind === 'grant' ? record.payload : null;
  if (p && typeof p.baseUrl === 'string' && typeof p.adminKey === 'string' && p.adminKey) return { baseUrl: normalizeBaseUrl(p.baseUrl), adminKey: p.adminKey };
  return null;
}
export function createMonitor({ credentials, fetchImpl = globalThis.fetch, signal: lifetimeSignal, timeoutMs = 20000 }) {
  const cache = new Map();
  let writes = Promise.resolve();
  const serial = action => { const next = writes.then(action, action); writes = next.catch(() => {}); return next; };
  async function readBinding() {
    try { return bindingOf(await credentials.readRecord(RECORD_KEY)); }
    catch (e) { if (e instanceof MonitorError) throw e; fail('STORAGE_ERROR', 'The Harness credential store could not be read.'); }
  }
  async function status() {
    const binding = await readBinding();
    return { configured: !!binding, hasKey: !!binding, baseUrl: binding?.baseUrl ?? DEFAULT_URL };
  }
  async function request(binding, query, signal) {
    const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : []), ...(lifetimeSignal ? [lifetimeSignal] : [])];
    const combined = AbortSignal.any(signals);
    try {
      const response = await fetchImpl(new URL(ENDPOINT, binding.baseUrl + '/'), {
        method: 'POST', headers: { authorization: `Bearer ${binding.adminKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(bodyFor(query)), redirect: 'error', signal: combined,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) fail('AUTH_FAILED', 'CPAMP rejected the Admin Key.');
        if (response.status === 403) fail('FORBIDDEN', 'CPAMP denied access.');
        if ([404, 405].includes(response.status)) fail('NOT_SUPPORTED', 'This CPAMP version or server URL does not expose the Full Mode analytics endpoint.');
        fail('UPSTREAM_ERROR', `CPAMP returned HTTP ${response.status}.`);
      }
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) { await response.body?.cancel(); fail('INVALID_RESPONSE', 'Expected JSON from CPAMP, not an HTML login or management page.'); }
      const reader = response.body?.getReader();
      if (!reader) fail('INVALID_RESPONSE', 'CPAMP returned an empty response.');
      let size = 0; const chunks = [];
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BODY) { await reader.cancel(); fail('INVALID_RESPONSE', 'CPAMP response exceeds the safe size limit. Choose a shorter time range.'); } chunks.push(value); }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
      let raw; try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('INVALID_RESPONSE', 'CPAMP returned invalid JSON.'); }
      return projectResponse(raw, query.kind);
    } catch (e) {
      if (e instanceof MonitorError) throw e;
      if (combined.aborted) fail('TIMEOUT', 'The CPAMP query timed out or was cancelled.');
      fail('NETWORK_ERROR', 'Cannot reach CPAMP. Check the URL, network and TLS certificate.');
    }
  }
  async function configure(input, signal) {
    return serial(async () => {
      const baseUrl = normalizeBaseUrl(input?.baseUrl);
      if (input?.adminKey !== undefined && typeof input.adminKey !== 'string') fail('KEY_REQUIRED', 'Enter the CPAMP Admin Key.');
      const previous = await readBinding();
      const adminKey = input?.adminKey?.trim() || (previous?.baseUrl === baseUrl ? previous.adminKey : '');
      if (!adminKey || adminKey.length > 4096 || /[\r\n]/.test(adminKey)) fail('KEY_REQUIRED', 'Enter the CPAMP Admin Key for this server.');
      const candidate = { baseUrl, adminKey };
      const now = Date.now();
      await request(candidate, { fromMs: now - 60000, toMs: now, timeZone: 'UTC', kind: 'overview' }, signal);
      if (signal?.aborted || lifetimeSignal?.aborted) fail('TIMEOUT', 'Connection was cancelled before saving.');
      try { await credentials.modifyRecord(RECORD_KEY, async () => ({ kind: 'grant', payload: candidate })); }
      catch { fail('STORAGE_ERROR', 'Connection verified, but the Harness credential store could not save it.'); }
      cache.clear();
      return { configured: true, hasKey: true, baseUrl };
    });
  }
  async function disconnect() {
    return serial(async () => {
      try { await credentials.deleteRecord(RECORD_KEY); } catch { fail('STORAGE_ERROR', 'The saved CPAMP connection could not be removed.'); }
      cache.clear();
      return { configured: false, hasKey: false, baseUrl: DEFAULT_URL };
    });
  }
  async function query(input, signal) {
    const validated = validateQuery(input);
    const binding = await readBinding();
    if (!binding) fail('NOT_CONFIGURED', 'Configure a CPAMP connection in the usage monitor first.');
    const key = createHash('sha256').update(JSON.stringify([binding, validated])).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return structuredClone(hit.value);
    const value = await request(binding, validated, signal);
    if (validated.kind === 'overview') {
      if (cache.size >= 8) cache.delete(cache.keys().next().value);
      cache.set(key, { expires: Date.now() + 20000, value: structuredClone(value) });
    }
    return value;
  }
  return { status, configure, disconnect, query };
}
export function publicError(error) {
  return error instanceof MonitorError ? { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: 'The usage monitor could not complete the operation.' };
}
