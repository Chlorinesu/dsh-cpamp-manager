import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { useLanguageStore } from '@/stores/useLanguageStore';
import '@/styles/global.scss';
import { applyHostStatus, clearLocalSessionCaches, disposeAuthSession, restoreHostSession, useAuthStore } from './auth';
import { inspectServerMetadata } from './adapters/api-client';
import { abortTransport, activateTransport, bridgeFetch, connectionAction, installTransport, managementPageUrl, type HostConnectionStatus } from './transport';
import { mountScope, refreshScopeTheme, scopedWindow, setScopeFetch, unmountScope } from './scope';
import { APPEARANCE_IDS, loadAppearance, normalizeAppearance, saveAppearance } from './appearance.mjs';
function preferenceStorage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }

declare const __CPAMP_STYLES__: string;
const UpstreamApp = lazy(() => import('../upstream/src/App'));
const NS = 'cpampAdmin';
const DEFAULT_URL = '';
let scopeOwner: symbol | null = null;
export const inject = ['slots', 'locale'];
const en = { appearance: 'Page palette', mist: 'Mist gray', ice: 'Ice blue', sand: 'Warm sand', host: 'Follow Harness', appearanceHint: 'Only affects CPAMP; light/dark follows Harness.', appearanceUnsaved: 'Palette changed for this view, but browser settings prevent saving it.', title: 'CPAMP manager', checking: 'Checking saved connection…', settings: 'Connection settings', base: 'CPAMP server URL', key: 'CPAMP Admin Key', hint: 'Credentials stay in the Harness Host. Leave the key blank only to keep an existing binding at the same address.', save: 'Test and save', saving: 'Testing…', disconnect: 'Disconnect and remove saved credentials', disconnectConfirm: 'Remove the CPAMP connection and saved credentials from Harness?', resume: 'Resume saved connection', retry: 'Retry', loading: 'Loading CPAMP…', external: 'Open original CPAMP', exitNotice: 'This management view is signed out. The saved Host connection has not been deleted.', humanOnly: 'Full CPAMP management for human operation. Writes require confirmation; no Agent write tools are added.', help: 'Use the CPAMP Admin Key, not the CPA Management Key or a model API key.', settingsClose: 'Close connection settings', reconnectConfirm: 'Saving the connection reloads the CPAMP page. Any unsaved edits in it will be lost. Continue?', pageLoadError: 'The CPAMP page could not be loaded. Refresh Harness and reopen this panel; the saved connection has not been removed.' };
const zh: typeof en = { appearance: '页面配色', mist: '雾灰', ice: '冰蓝', sand: '暖砂', host: '跟随 Harness', appearanceHint: '只影响 CPAMP 页面，明暗模式跟随 Harness。', appearanceUnsaved: '配色已在当前页面生效，但浏览器设置阻止保存选择。', title: 'CPAMP 管理', checking: '正在检查已保存的连接…', settings: '连接设置', base: 'CPAMP 服务地址', key: 'CPAMP Admin Key', hint: '凭据仅保存在 Harness Host。同一地址留空可保留已有密钥；更换地址必须重新输入。', save: '测试并保存', saving: '正在测试…', disconnect: '断开并删除保存的连接凭据', disconnectConfirm: '确定从 Harness 删除 CPAMP 连接及保存的凭据吗？', resume: '恢复已保存的连接', retry: '重试', loading: '正在加载 CPAMP…', external: '打开原 CPAMP', exitNotice: '已退出此管理视图。Host 中保存的连接未被删除。', humanOnly: '完整 CPAMP 后台仅供人类操作。写操作需确认，不新增 Agent 写工具。', help: '请使用 CPAMP Admin Key，而非 CPA 管理密钥或模型 API Key。', settingsClose: '关闭连接设置', reconnectConfirm: '保存连接会重新加载当前 CPAMP 页面，其中未保存的编辑将丢失。是否继续？', pageLoadError: 'CPAMP 页面加载失败。请刷新 Harness 后重新打开此面板；已保存的连接不会因此删除。' };
function Icon({ size = 20 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v16h16M8 16v-4m4 4V7m4 9v-7m4 7V5" /></svg>; }

class AppBoundary extends React.Component<{ children: React.ReactNode; message: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="cpamp-adapter-error" role="alert">{this.props.message}</div> : this.props.children; }
}

export function apply(ctx: any) {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }));
  const t = ctx.locale.bind(NS);
  const subscribeLocale = (fn: () => void) => ctx.locale.subscribe(fn);
  const localeSnapshot = () => ctx.locale.getSnapshot();
  ctx.effect(() => installTransport(() => localeSnapshot().active));
  function Panel() {
    const locale = useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot) as { active: string };
    const hostRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);
    const alive = useRef(false);
    const isAuthenticated = useAuthStore(state => state.isAuthenticated);
    const [mounted, setMounted] = useState(false);
    const [checking, setChecking] = useState(true);
    const [status, setStatus] = useState<HostConnectionStatus | null>(null);
    const [error, setError] = useState('');
    const [baseUrl, setBaseUrl] = useState(DEFAULT_URL);
    const [adminKey, setAdminKey] = useState('');
    const [busy, setBusy] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [generation, setGeneration] = useState(0);
    const [appearance, setAppearance] = useState(() => loadAppearance(preferenceStorage()));
    const [appearanceUnsaved, setAppearanceUnsaved] = useState(false);
    const chooseAppearance = (value: string) => {
      const id = normalizeAppearance(value);
      setAppearance(id);
      setAppearanceUnsaved(!saveAppearance(preferenceStorage(), id));
    };
    const reconcile = async () => {
      const value = await restoreHostSession();
      if (alive.current) { setStatus(value); setBaseUrl(value.baseUrl); }
      return value;
    };
    useLayoutEffect(() => {
      const host = hostRef.current;
      if (host) setShadowRoot(host.shadowRoot ?? host.attachShadow({ mode: 'open' }));
    }, []);
    useEffect(() => {
      if (!shadowRoot) return;
      const root = rootRef.current;
      if (!root) return;
      const owner = Symbol('cpamp-panel'); scopeOwner = owner; alive.current = true;
      mountScope(root, () => ctx.get('theme')?.getTheme().active.colorScheme);
      const stopThemeSync = ctx.on('theme/change', refreshScopeTheme);
      activateTransport(); setScopeFetch(bridgeFetch);
      setMounted(true); setChecking(true);
      reconcile().catch(reason => { if (alive.current) setError(reason instanceof Error ? reason.message : 'Connection failed.'); }).finally(() => { if (alive.current) setChecking(false); });
      const reload = () => { if (alive.current) { setGeneration(value => value + 1); void reconcile().catch(reason => { if (alive.current) setError(reason instanceof Error ? reason.message : 'Connection failed.'); }); } };
      scopedWindow.addEventListener('cpamp:reload', reload);
      return () => {
        alive.current = false; stopThemeSync(); setScopeFetch(null); abortTransport(); disposeAuthSession();
        scopedWindow.removeEventListener('cpamp:reload', reload);
        // Child effect cleanups may still address the scoped document during unmount.
        queueMicrotask(() => { if (scopeOwner === owner) { unmountScope(); scopeOwner = null; } });
      };
      // The Portal commits rootRef before this effect runs. A first render with
      // no ShadowRoot must not consume this mount effect permanently.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shadowRoot]);
    useEffect(() => {
      if (!mounted) return;
      const supported = locale.active.startsWith('zh') ? 'zh-CN' : locale.active.startsWith('ru') ? 'ru' : 'en';
      useLanguageStore.getState().setLanguage(supported);
    }, [locale.active, mounted]);
    useEffect(() => {
      if (mounted && isAuthenticated) void inspectServerMetadata().catch(() => { /* The original page owns read errors; no automatic writes or login changes. */ });
    }, [mounted, isAuthenticated, generation]);
    const save = async (event: FormEvent) => {
      event.preventDefault(); if (busy) return;
      if (isAuthenticated && !globalThis.confirm(t('reconnectConfirm'))) return;
      const key = adminKey; setAdminKey(''); setBusy(true); setError('');
      try {
        const value = await connectionAction('configure', { baseUrl: baseUrl.trim(), adminKey: key });
        if (alive.current) { clearLocalSessionCaches(); applyHostStatus(value); setStatus(value); setBaseUrl(value.baseUrl); setShowSettings(false); setGeneration(value => value + 1); }
      } catch (reason) {
        if (alive.current) { setError(reason instanceof Error ? reason.message : 'Connection failed.'); try { await reconcile(); } catch { /* Preserve the original safe error. */ } }
      } finally { if (alive.current) setBusy(false); }
    };
    const disconnect = async () => {
      if (busy || !globalThis.confirm(t('disconnectConfirm'))) return;
      setAdminKey(''); setBusy(true); setError('');
      try { const value = await connectionAction('disconnect'); if (alive.current) { applyHostStatus(value); setStatus(value); setBaseUrl(value.baseUrl); setShowSettings(true); } }
      catch (reason) { if (alive.current) { setError(reason instanceof Error ? reason.message : 'Disconnect failed.'); try { await reconcile(); } catch { /* Preserve the original safe error. */ } } }
      finally { if (alive.current) setBusy(false); }
    };
    const resume = async () => { if (busy) return; setBusy(true); setError(''); try { await reconcile(); } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Connection failed.'); } finally { if (alive.current) { setBusy(false); setChecking(false); } } };
    let originalUrl = ''; try { if (status?.baseUrl) originalUrl = managementPageUrl(status.baseUrl); } catch { /* No unvalidated external URL. */ }
    const form = <section className="cpamp-connection-settings" aria-label={t('settings')}>
      <h2>{t('settings')}</h2><p>{t('help')}</p><p>{t('hint')}</p>
      <form onSubmit={save} autoComplete="off"><label>{t('base')}<input type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} disabled={busy || checking} required autoComplete="off" spellCheck={false} /></label>
        <label>{t('key')}<input type="password" value={adminKey} onChange={event => setAdminKey(event.target.value)} disabled={busy || checking} autoComplete="new-password" spellCheck={false} /></label>
        <button type="submit" disabled={busy || checking}>{t(busy ? 'saving' : 'save')}</button>
        {status?.configured && <><button type="button" disabled={busy || checking} onClick={() => void resume()}>{t('resume')}</button><button type="button" disabled={busy || checking} onClick={() => void disconnect()}>{t('disconnect')}</button></>}
      </form>
    </section>;
    const content = <div className="cpamp-admin" ref={rootRef} aria-label={t('title')} data-connection-settings={showSettings ? 'open' : undefined} data-palette={appearance}>
      <style>{typeof __CPAMP_STYLES__ === 'string' ? __CPAMP_STYLES__ : ''}</style>
      {mounted && <>
        <div className="cpamp-port-controls"><span>{t('humanOnly')}</span><label className="cpamp-palette-picker" title={t('appearanceHint')}>{t('appearance')}<select value={appearance} onChange={event => chooseAppearance(event.target.value)} aria-label={t('appearance')}>{APPEARANCE_IDS.map(id => <option key={id} value={id}>{t(id)}</option>)}</select></label><button type="button" disabled={busy} onClick={() => setShowSettings(value => !value)}>{t(showSettings ? 'settingsClose' : 'settings')}</button>{originalUrl && <a href={originalUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t('external')}</a>}</div>
        {appearanceUnsaved && <div className="cpamp-adapter-notice" role="status">{t('appearanceUnsaved')}</div>}
        {error && <div className="cpamp-adapter-error" role="alert">{error}</div>}
        {checking ? <p role="status">{t('checking')}</p> : !isAuthenticated || showSettings ? <>{status?.configured && !isAuthenticated && <p>{t('exitNotice')}</p>}{form}{!status && <button type="button" disabled={busy} onClick={() => void resume()}>{t('retry')}</button>}</> : null}
        {!checking && isAuthenticated && <AppBoundary key={generation} message={t('pageLoadError')}><I18nextProvider i18n={i18n}><Suspense fallback={<p role="status">{t('loading')}</p>}><UpstreamApp key={generation} /></Suspense></I18nextProvider></AppBoundary>}
      </>}
    </div>;
    return <div className="cpamp-shadow-host" ref={hostRef} style={{ height: '100%', width: '100%', minWidth: 0, minHeight: 0 }}>
      {shadowRoot ? createPortal(content, shadowRoot) : null}
    </div>;
  }
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'cpamp-monitor', order: 20, label: () => t('title') }, Icon));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'cpamp-monitor' }, Panel));
}
