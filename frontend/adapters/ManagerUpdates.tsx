import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePanelFeatureAvailability } from '@/hooks/usePanelFeatureAvailability';
import { managerUpdateRequest, type UpdateChannel, type UpdateStatus } from '@/features/system/managerUpdateApi';
import { useAuthStore } from '../auth';
import { scopedDocument } from '../scope';
interface Updates { status: UpdateStatus | null; available: boolean; busy: boolean; error: boolean; check: () => Promise<void>; setChannel: (channel: UpdateChannel) => Promise<void> }
const Context = createContext<Updates>({ status: null, available: false, busy: false, error: false, check: async () => {}, setChannel: async () => {} });
export const useManagerUpdates = () => useContext(Context);
/** Retains the real update page/provider without automatic notification-claim writes. */
export function ManagerUpdates({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const location = useLocation();
  const availability = usePanelFeatureAvailability();
  const authenticated = useAuthStore(state => state.isAuthenticated);
  const marker = useAuthStore(state => state.managementKey);
  const base = availability.managerServiceBase;
  const available = authenticated && availability.managerServiceAvailable && !!base;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const refresh = useCallback(async (suffix = '', method = 'GET', data?: unknown) => {
    if (!available || inFlight.current) return;
    const current = generation.current; inFlight.current = true;
    if (method !== 'GET') setBusy(true);
    try { const next = await managerUpdateRequest<UpdateStatus>(base, marker, suffix, method, data); if (current === generation.current) { setStatus(next); setError(false); } }
    catch { if (current === generation.current) setError(true); }
    finally { if (current === generation.current) { inFlight.current = false; setBusy(false); } }
  }, [available, base, marker]);
  useEffect(() => {
    generation.current += 1; inFlight.current = false; setStatus(null); setError(false); setBusy(false);
    if (available) void refresh();
    const interval = globalThis.setInterval(() => { if (scopedDocument.visibilityState === 'visible') void refresh(); }, 60000);
    return () => { generation.current += 1; globalThis.clearInterval(interval); };
  }, [available, refresh]);
  const zh = i18n.language.startsWith('zh');
  return <Context.Provider value={{ status, available, busy, error, check: () => refresh('/check', 'POST'), setChannel: channel => refresh('/channel', 'PUT', { channel_preference: channel }) }}>
    {location.pathname === '/system/updates' && <p className="cpamp-adapter-notice" role="note">{zh ? '嵌入模式只自动读取更新状态，不自动标记通知或执行更新。检查更新、切换渠道及其他管理操作仍需手动确认。' : 'Embedded mode automatically reads update status only. It does not claim notifications or execute updates. Checking updates, switching channels and other management actions require explicit confirmation.'}</p>}
    {children}
  </Context.Provider>;
}
