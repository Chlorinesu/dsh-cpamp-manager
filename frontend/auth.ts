import { create } from 'zustand';
import type { AuthSessionMode, AuthState, LoginCredentials, LoginResult, RestoreSessionResult, ConnectionStatus } from '@/types';
import { useConfigStore } from '@/stores/useConfigStore';
import { useModelsStore } from '@/stores/useModelsStore';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { useUsageServiceStore } from '@/stores/useUsageServiceStore';
import { apiClient } from './adapters/api-client';
import { connectionAction, setTransportBase, type HostConnectionStatus } from './transport';
import { setScopeBaseUrl } from './scope';

// This value is a non-secret capability-presence marker. The real CPAMP Admin Key
// is never returned from the Host or retained by this Zustand store.
export const HOST_CREDENTIAL_MARKER = 'harness-host-managed-credential';
interface RestoreSessionOptions { expectedMode?: AuthSessionMode; expectedPanelBase?: string }
interface AuthStoreState extends AuthState {
  sessionMode: AuthSessionMode | '';
  sessionPanelBase: string;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  login: (credentials: LoginCredentials) => Promise<LoginResult>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  restoreSession: (options?: RestoreSessionOptions) => Promise<RestoreSessionResult>;
  updateServerVersion: (version: string | null, buildDate?: string | null, commit?: string | null) => void;
  updateServerPluginSupport: (supportsPlugin: boolean) => void;
  updateConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
}
let restorePromise: Promise<RestoreSessionResult> | null = null;
let localExit = false;
let sessionGeneration = 0;
function clearSessionCaches() {
  useConfigStore.getState().clearCache();
  useModelsStore.getState().clearCache();
  useQuotaStore.getState().clearQuotaCache();
}
export function applyHostStatus(status: HostConnectionStatus) {
  if (status.configured) localExit = false;
  const previous = useAuthStore.getState();
  const changedServer = previous.apiBase !== status.baseUrl;
  if (changedServer || !status.configured) clearSessionCaches();
  setTransportBase(status.baseUrl);
  setScopeBaseUrl(status.baseUrl);
  apiClient.setConfig({ apiBase: status.baseUrl, managementKey: '' });
  if (status.configured) {
    useUsageServiceStore.getState().setUsageServiceConfig({ enabled: true, serviceBase: status.baseUrl }, { panelBase: status.baseUrl, panelHostMode: 'manager_embedded' });
  } else {
    useUsageServiceStore.getState().clearUsageServiceConfig();
  }
  useAuthStore.setState({
    apiBase: status.baseUrl, sessionPanelBase: status.baseUrl, sessionMode: 'manager_embedded',
    managementKey: status.configured ? HOST_CREDENTIAL_MARKER : '', rememberPassword: false,
    isAuthenticated: status.configured, connectionStatus: status.configured ? 'connected' : 'disconnected', connectionError: null,
    ...(changedServer ? { serverVersion: null, serverCommit: null, serverBuildDate: null, supportsPlugin: false } : {}),
  });
}
export const useAuthStore = create<AuthStoreState>()((set, get) => ({
  isAuthenticated: false, apiBase: '', managementKey: '', rememberPassword: false,
  serverVersion: null, serverCommit: null, serverBuildDate: null, supportsPlugin: false,
  sessionMode: 'manager_embedded', sessionPanelBase: '', connectionStatus: 'disconnected', connectionError: null,
  async login(credentials) {
    const generation = sessionGeneration;
    set({ connectionStatus: 'connecting', connectionError: null });
    try {
      const key = credentials.managementKey === HOST_CREDENTIAL_MARKER ? '' : credentials.managementKey;
      const status = await connectionAction('configure', { baseUrl: credentials.apiBase, adminKey: key });
      if (generation !== sessionGeneration) return {};
      localExit = false; clearSessionCaches(); applyHostStatus(status); return {};
    } catch (error) {
      if (generation === sessionGeneration) set({ connectionStatus: 'error', connectionError: error instanceof Error ? error.message : 'Connection failed.' });
      throw error;
    }
  },
  logout() {
    // Exiting this view does not revoke/delete a saved Host credential binding.
    localExit = true; sessionGeneration += 1; restorePromise = null;
    clearSessionCaches();
    set({ isAuthenticated: false, managementKey: '', connectionStatus: 'disconnected', connectionError: null });
  },
  async checkAuth() {
    const generation = sessionGeneration;
    try {
      const status = await connectionAction('status');
      if (generation !== sessionGeneration || localExit) return false;
      applyHostStatus(status); return status.configured;
    } catch (error) {
      if (generation === sessionGeneration) set({ isAuthenticated: false, managementKey: '', connectionStatus: 'error', connectionError: error instanceof Error ? error.message : 'Connection status failed.' });
      throw error;
    }
  },
  restoreSession() {
    if (localExit) return Promise.resolve(false);
    if (restorePromise) return restorePromise;
    restorePromise = get().checkAuth().then(authenticated => authenticated ? {} : false).finally(() => { restorePromise = null; });
    return restorePromise;
  },
  updateServerVersion(version, buildDate, commit) { set({ serverVersion: version, serverBuildDate: buildDate ?? null, serverCommit: commit ?? null }); },
  updateServerPluginSupport(supportsPlugin) { set({ supportsPlugin }); },
  updateConnectionStatus(connectionStatus, connectionError) { set({ connectionStatus, connectionError: connectionError ?? null }); },
}));
export async function restoreHostSession(): Promise<HostConnectionStatus> {
  localExit = false;
  const generation = ++sessionGeneration;
  const status = await connectionAction('status');
  if (generation === sessionGeneration) applyHostStatus(status);
  return status;
}
export function disposeAuthSession() {
  sessionGeneration += 1; restorePromise = null;
  useAuthStore.setState({ isAuthenticated: false, managementKey: '', connectionStatus: 'disconnected' });
}
export function clearLocalSessionCaches() { clearSessionCaches(); }
