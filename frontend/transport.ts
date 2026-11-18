import axios, { AxiosError, AxiosHeaders, CanceledError, type AxiosAdapter, type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { READ_ONLY_POST_PATHS, classifyAdminRequest, isReadOnlyApiHelper } from '../admin-policy.js';

export interface HostConnectionStatus { configured: boolean; baseUrl: string; hasKey: boolean }
export type ConnectionAction = 'status' | 'configure' | 'disconnect';
let boundBase = '';
let active = false;
let language: () => string = () => 'en';
const pending = new Set<AbortController>();
const nativeFetch = (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args);

export function setTransportBase(baseUrl: string) { boundBase = baseUrl.replace(/\/+$/, ''); }
export function activateTransport() { active = true; }
export function abortTransport() { active = false; for (const controller of pending) controller.abort(); pending.clear(); }
export function isChinese() { return language().startsWith('zh'); }
export function hostEndpoint(path: string): URL { return new URL(path.replace(/^\//, ''), globalThis.document.baseURI); }

function canceled() { return new CanceledError(isChinese() ? '操作已取消。' : 'Operation cancelled.'); }
function cleanErrorConfig(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  return { ...config, url: String(config.url || '').split(/[?#]/, 1)[0], baseURL: undefined, params: undefined, data: undefined, headers: new AxiosHeaders() };
}
function safePathLabel(path: string): string {
  // Query values can contain API keys, OAuth codes or credentials. Never show them.
  return path.split('?', 1)[0].replace(/[\r\n\u0000-\u001f]/g, '').slice(0, 180);
}
function normalizePath(url: string, baseURL?: string, params?: unknown, paramsSerializer?: AxiosRequestConfig['paramsSerializer']): string {
  const target = axios.getUri({ url, baseURL, params, paramsSerializer });
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
  let path: string;
  if (absolute) {
    if (!boundBase) throw new AxiosError('Configure the CPAMP connection first.', 'ERR_CPAMP_NOT_CONFIGURED');
    const base = new URL(boundBase + '/');
    const candidate = new URL(target, base);
    const prefix = base.pathname.replace(/\/+$/, '');
    if (candidate.origin !== base.origin || candidate.username || candidate.password || (prefix && !candidate.pathname.startsWith(prefix + '/'))) {
      throw new AxiosError(isChinese() ? '嵌入后台不允许直连其他服务器，请在原 CPAMP 页面执行此操作。' : 'Embedded management does not connect directly to other servers. Use the original CPAMP page for this operation.', 'ERR_CPAMP_EXTERNAL_TARGET');
    }
    path = candidate.pathname.slice(prefix.length) + candidate.search;
  } else {
    path = target.startsWith('/') ? target : '/' + target;
  }
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n\u0000]/.test(path) || path.includes('#')) throw new AxiosError('Invalid CPAMP management path.', 'ERR_CPAMP_PATH');
  return path;
}
function readJson(data: unknown): Record<string, unknown> | undefined {
  try { const value = typeof data === 'string' ? JSON.parse(data) : data; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; } catch { return undefined; }
}
function requiresConfirmation(method: string, path: string, data?: unknown): boolean {
  const pathname = path.split('?', 1)[0];
  if (method === 'POST' && pathname === '/v0/management/monitoring/account-history' && readJson(data)?.catch_up !== true) return false;
  if (method === 'POST' && READ_ONLY_POST_PATHS.includes(pathname)) return false;
  if (method === 'POST' && pathname === '/v0/management/api-call' && isReadOnlyApiHelper(readJson(data))) return false;
  const decision = classifyAdminRequest(method, path);
  if (decision.allowed) return decision.requiresConfirmation;
  // Host remains authoritative and returns explicit rejection for unsupported paths.
  return !['GET', 'HEAD'].includes(method);
}
function confirmWrite(method: string, path: string, data?: unknown) {
  if (!requiresConfirmation(method, path, data)) return false;
  let label = safePathLabel(path);
  if (path.split('?', 1)[0] === '/v0/management/api-call') {
    const payload = readJson(data);
    try {
      if (typeof payload?.url === 'string') {
        const target = new URL(payload.url);
        const innerMethod = String(payload.method ?? 'GET').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12);
        label += '\n' + innerMethod + ' ' + target.origin + safePathLabel(target.pathname);
      }
    } catch { /* Invalid targets are rejected by the Host without echoing request data. */ }
  }
  const prompt = isChinese()
    ? `确认执行 CPAMP 管理操作？\n\n${method} ${label}\n\n此操作可能修改远程配置、凭据、账户状态或服务数据。请求内容与密钥不会在此处显示。`
    : `Confirm this CPAMP management operation?\n\n${method} ${label}\n\nThis may change remote configuration, credentials, account state or service data. Request contents and keys are not displayed here.`;
  if (!globalThis.confirm(prompt)) throw canceled();
  return true;
}
function requestSignal(signal?: AbortSignal | null, timeout = 30000) {
  const controller = new AbortController();
  pending.add(controller);
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = timeout > 0 ? globalThis.setTimeout(() => { timedOut = true; controller.abort(); }, timeout) : undefined;
  return { controller, timedOut: () => timedOut, dispose: () => { if (timer !== undefined) globalThis.clearTimeout(timer); signal?.removeEventListener('abort', abort); pending.delete(controller); } };
}
function requestBody(data: unknown, headers: AxiosHeaders): BodyInit | undefined {
  if (data == null) return undefined;
  if (typeof FormData !== 'undefined' && data instanceof FormData) { headers.delete('content-type'); return data; }
  if (typeof data === 'string' || data instanceof Blob || data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof URLSearchParams) return data as BodyInit;
  headers.set('content-type', 'application/json'); return JSON.stringify(data);
}
async function sendBridge(path: string, method: string, data: unknown, sourceHeaders: Headers | AxiosHeaders, signal: AbortSignal, confirmed: boolean) {
  const headers = new Headers({ 'x-cpamp-method': method, 'x-cpamp-path': encodeURIComponent(path) });
  const originalType = sourceHeaders.get('content-type');
  if (typeof originalType === 'string' && originalType) headers.set('content-type', originalType);
  if (confirmed) headers.set('x-cpamp-confirmed', '1');
  // Model-list endpoints require a CPA client key, never the CPAMP Admin Key.
  // The Host independently validates this dedicated header and never falls back
  // to the saved management credential for these exact GET endpoints.
  if (method === 'GET' && (path === '/v1/models' || path === '/models')) {
    const authorization = sourceHeaders.get('authorization');
    if (typeof authorization !== 'string' || !/^Bearer [\x21-\x7e]{1,4096}$/i.test(authorization) || authorization.toLowerCase().includes('harness-host-managed-credential')) {
      throw new AxiosError(isChinese() ? '读取模型列表需要 CPA 客户端 API Key，不能使用 CPAMP Admin Key。' : 'Reading models requires a CPA client API key, not the CPAMP Admin Key.', 'ERR_CPAMP_MODEL_KEY');
    }
    headers.set('x-cpamp-model-authorization', authorization);
  }
  // Other management routes receive routing/content-type only. Never forward
  // client Authorization, Cookie, proxy credentials or arbitrary target headers.
  const bodyHeaders = new AxiosHeaders();
  if (headers.has('content-type')) bodyHeaders.set('content-type', headers.get('content-type'));
  const body = requestBody(data, bodyHeaders);
  if (bodyHeaders.has('content-type')) headers.set('content-type', String(bodyHeaders.get('content-type'))); else headers.delete('content-type');
  return nativeFetch(hostEndpoint('api/cpamp-admin/bridge'), { method: 'POST', credentials: 'same-origin', headers, body, redirect: 'error', signal });
}
export const bridgeAxiosAdapter: AxiosAdapter = async config => {
  if (!active || config.signal?.aborted) throw canceled();
  const method = String(config.method || 'GET').toUpperCase();
  const requestUrl = axios.getUri({ url: config.url || '/', baseURL: config.baseURL, params: config.params, paramsSerializer: config.paramsSerializer });
  const publicRelease = method === 'GET' && requestUrl === 'https://raw.githubusercontent.com/seakee/CPA-Manager-Plus/update-channel/update-index.json';
  const path = publicRelease ? '/public-release' : normalizePath(config.url || '/', config.baseURL, config.params, config.paramsSerializer);
  const confirmed = publicRelease ? false : confirmWrite(method, path, config.data);
  if (!active || config.signal?.aborted) throw canceled();
  const lifetime = requestSignal(config.signal as AbortSignal, config.timeout ?? 30000);
  const cancelToken = config.cancelToken;
  const cancel = () => lifetime.controller.abort();
  cancelToken?.subscribe(cancel);
  try {
    const response = publicRelease
      ? await nativeFetch(hostEndpoint('api/cpamp-admin/public-release'), { method: 'GET', credentials: 'same-origin', redirect: 'error', signal: lifetime.controller.signal })
      : await sendBridge(path, method, config.data, AxiosHeaders.from(config.headers), lifetime.controller.signal, confirmed);
    const responseHeaders = new AxiosHeaders(); response.headers.forEach((value, key) => responseHeaders.set(key, value));
    let data: unknown;
    switch (config.responseType) {
      case 'arraybuffer': data = await response.arrayBuffer(); break;
      case 'blob': data = await response.blob(); break;
      case 'stream': data = response.body; break;
      default: data = await response.text(); break; // Axios's normal transformResponse parses JSON.
    }
    const result: AxiosResponse = { data, status: response.status, statusText: response.statusText, headers: responseHeaders, config, request: undefined };
    const validate = config.validateStatus;
    if (!response.status || !validate || validate(response.status)) return result;
    const safeConfig = cleanErrorConfig(config);
    throw new AxiosError(`CPAMP returned HTTP ${response.status}.`, response.status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', safeConfig, undefined, { ...result, config: safeConfig });
  } catch (error) {
    if (axios.isCancel(error)) throw error;
    if (lifetime.controller.signal.aborted) {
      if (lifetime.timedOut()) throw new AxiosError(isChinese() ? 'CPAMP 请求超时。' : 'CPAMP request timed out.', 'ECONNABORTED', cleanErrorConfig(config));
      throw canceled();
    }
    if (axios.isAxiosError(error)) throw error;
    throw new AxiosError(isChinese() ? '无法访问 Harness 的 CPAMP 管理桥，请检查连接设置。' : 'Cannot reach the Harness CPAMP bridge. Check the connection settings.', 'ERR_NETWORK', cleanErrorConfig(config));
  } finally { cancelToken?.unsubscribe(cancel); lifetime.dispose(); }
};

export function installTransport(getLanguage: () => string) {
  const previous = axios.defaults.adapter; const previousLanguage = language;
  language = getLanguage; axios.defaults.adapter = bridgeAxiosAdapter;
  return () => { abortTransport(); if (axios.defaults.adapter === bridgeAxiosAdapter) axios.defaults.adapter = previous; language = previousLanguage; };
}
export async function connectionAction(action: ConnectionAction, values: { baseUrl?: string; adminKey?: string } = {}): Promise<HostConnectionStatus> {
  if (!active) throw canceled();
  const lifetime = requestSignal(undefined, 35000);
  try {
    const response = await nativeFetch(hostEndpoint('api/cpamp-monitor'), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...values }), signal: lifetime.controller.signal, redirect: 'error' });
    const result = await response.json();
    if (!response.ok || result?.ok !== true) {
      const code = typeof result?.error?.code === 'string' ? result.error.code : 'ERR_CPAMP_CONNECTION';
      const error = new Error(isChinese() ? `连接操作失败（${code}）。请检查 CPAMP 地址与 Admin Key。` : `Connection operation failed (${code}). Check the CPAMP URL and Admin Key.`) as Error & { code?: string };
      error.code = code; throw error;
    }
    if (!result.value || typeof result.value.configured !== 'boolean' || typeof result.value.baseUrl !== 'string') throw new Error(isChinese() ? '连接状态响应格式不正确。' : 'Invalid connection status response.');
    return result.value;
  } catch (error) {
    if (lifetime.controller.signal.aborted) throw lifetime.timedOut() ? new Error(isChinese() ? '连接操作超时。' : 'Connection operation timed out.') : canceled();
    if (error instanceof Error) throw error;
    throw new Error(isChinese() ? '无法读取 CPAMP 连接状态。' : 'Cannot read CPAMP connection status.');
  } finally { lifetime.dispose(); }
}

/** Fetch-compatible transport for any upstream non-Axios request. No global patching. */
export async function bridgeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!active) throw canceled();
  const request = input instanceof Request ? input : undefined;
  const url = request?.url ?? String(input);
  const method = String(init.method ?? request?.method ?? 'GET').toUpperCase();
  const path = normalizePath(url);
  const headers = new Headers(init.headers ?? request?.headers);
  let data: unknown = init.body;
  if (data == null && request && !['GET', 'HEAD'].includes(method)) data = await request.clone().arrayBuffer();
  const confirmed = confirmWrite(method, path, data);
  const lifetime = requestSignal(init.signal ?? request?.signal, 30000);
  try {
    const response = await sendBridge(path, method, data, headers, lifetime.controller.signal, confirmed);
    const bytes = ['HEAD'].includes(method) || [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer();
    const responseHeaders = new Headers(response.headers); responseHeaders.delete('content-length'); responseHeaders.delete('content-encoding');
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  }
  catch (error) { if (lifetime.controller.signal.aborted) throw canceled(); throw error; }
  finally { lifetime.dispose(); }
}

export function managementPageUrl(baseUrl: string, route = '/'): string {
  const url = new URL(baseUrl.replace(/\/+$/, '') + '/management.html');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid CPAMP address.');
  url.hash = route.startsWith('/') ? route : '/'; return url.href;
}
