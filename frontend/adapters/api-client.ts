import axios, { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import type { ApiClientConfig, ApiError } from '@/types';
import { BUILD_DATE_HEADER_KEYS, COMMIT_HEADER_KEYS, CPA_SUPPORT_PLUGIN_HEADER_KEYS, REQUEST_TIMEOUT_MS, VERSION_HEADER_KEYS } from '@/utils/constants';
import { scopedWindow } from '../scope';
import { bridgeAxiosAdapter } from '../transport';

export type ApiClientRequestScope = Pick<ApiClientConfig, 'apiBase' | 'managementKey'>;
export type ScopedApiRequestConfig = AxiosRequestConfig & { cpampScopedRequest?: true };
export const createScopedApiRequestConfig = (scope: ApiClientRequestScope): ScopedApiRequestConfig => ({ baseURL: scope.apiBase.replace(/\/+$/, '') + '/v0/management', cpampScopedRequest: true });
let configuredBase = '';
let configuredTimeout = REQUEST_TIMEOUT_MS;
const readHeader = (headers: AxiosResponse['headers'], keys: string[]) => {
  const normalized = AxiosHeaders.from(headers);
  for (const key of keys) { const value = normalized.get(key); if (value !== undefined && value !== null && String(value)) return String(value); }
  return null;
};
function endpoint(url: string): string {
  const normalized = url.replace(/\/generative-language-api-key\b/g, '/gemini-api-key');
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith('/v0/management/')) return configuredBase + normalized;
  return configuredBase + '/v0/management' + (normalized.startsWith('/') ? normalized : '/' + normalized);
}
async function requestRaw<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  const headers = AxiosHeaders.from(config.headers);
  headers.delete('authorization'); headers.delete('cookie'); headers.delete('proxy-authorization');
  const scoped = (config as ScopedApiRequestConfig).cpampScopedRequest === true;
  const url = scoped && config.baseURL ? new URL(String(config.url || '').replace(/^\//, ''), config.baseURL.replace(/\/+$/, '') + '/').href : endpoint(config.url || '/');
  try {
    const response = await axios.request<T>({ ...config, url, baseURL: undefined, timeout: config.timeout ?? configuredTimeout, headers, adapter: bridgeAxiosAdapter });
    const version = readHeader(response.headers, VERSION_HEADER_KEYS);
    const commit = readHeader(response.headers, COMMIT_HEADER_KEYS);
    const buildDate = readHeader(response.headers, BUILD_DATE_HEADER_KEYS);
    const plugin = readHeader(response.headers, CPA_SUPPORT_PLUGIN_HEADER_KEYS);
    if (version || commit || buildDate) scopedWindow.dispatchEvent(new CustomEvent('server-version-update', { detail: { version, commit, buildDate } }));
    if (plugin !== null) scopedWindow.dispatchEvent(new CustomEvent('server-plugin-support-update', { detail: { supportsPlugin: ['1', 'true', 'yes', 'on'].includes(plugin.toLowerCase()) } }));
    return response;
  } catch (error) {
    if (axios.isCancel(error)) throw error;
    if (!axios.isAxiosError(error)) throw error;
    const payload = error.response?.data;
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
    const upstreamError = record?.error;
    const message = typeof upstreamError === 'string' ? upstreamError : upstreamError && typeof upstreamError === 'object' && typeof (upstreamError as Record<string, unknown>).message === 'string' ? String((upstreamError as Record<string, unknown>).message) : typeof record?.message === 'string' ? record.message : error.message;
    const result = new Error(message) as ApiError;
    result.name = 'ApiError'; result.code = error.code; result.status = error.response?.status; result.details = payload; result.data = payload;
    if (result.status === 401) scopedWindow.dispatchEvent(new Event('unauthorized'));
    throw result;
  }
}
export const apiClient = {
  setConfig(config: ApiClientConfig) { configuredBase = config.apiBase.replace(/\/+$/, ''); configuredTimeout = config.timeout || REQUEST_TIMEOUT_MS; },
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> { return (await requestRaw<T>({ ...config, url, method: 'GET' })).data; },
  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> { return (await requestRaw<T>({ ...config, url, method: 'POST', data })).data; },
  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> { return (await requestRaw<T>({ ...config, url, method: 'PUT', data })).data; },
  async patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> { return (await requestRaw<T>({ ...config, url, method: 'PATCH', data })).data; },
  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> { return (await requestRaw<T>({ ...config, url, method: 'DELETE' })).data; },
  getRaw(url: string, config?: AxiosRequestConfig) { return requestRaw({ ...config, url, method: 'GET' }); },
  async postForm<T = unknown>(url: string, formData: FormData, config?: AxiosRequestConfig): Promise<T> {
    const headers = AxiosHeaders.from(config?.headers); headers.delete('content-type');
    return (await requestRaw<T>({ ...config, url, method: 'POST', data: formData, headers })).data;
  },
  requestRaw,
};

/** Read server metadata only. There is no remote collector/start mutation here. */
export async function inspectServerMetadata() { return apiClient.get('/config'); }
