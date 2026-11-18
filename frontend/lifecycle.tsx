import { useEffect } from 'react';
import { useLanguageStore, useVisualEffectsStore } from '@/stores';
import { useThemeStore } from './adapters/useThemeStore';
import { useAuthStore } from './auth';
import { scopedDocument, scopedWindow } from './scope';

/** Same upstream lifecycle responsibilities, confined to the mounted plugin root. */
export function AppLifecycle() {
  const initializeTheme = useThemeStore(state => state.initializeTheme);
  const initializeVisualEffects = useVisualEffectsStore(state => state.initializeVisualEffects);
  const language = useLanguageStore(state => state.language);
  useEffect(() => initializeTheme(), [initializeTheme]);
  useEffect(() => { initializeVisualEffects(); }, [initializeVisualEffects]);
  useEffect(() => { scopedDocument.documentElement.lang = language; }, [language]);
  useEffect(() => {
    const version = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail) useAuthStore.getState().updateServerVersion(typeof detail.version === 'string' ? detail.version : null, typeof detail.buildDate === 'string' ? detail.buildDate : null, typeof detail.commit === 'string' ? detail.commit : null);
    };
    const plugin = (event: Event) => { const detail = (event as CustomEvent).detail; if (typeof detail?.supportsPlugin === 'boolean') useAuthStore.getState().updateServerPluginSupport(detail.supportsPlugin); };
    const unauthorized = () => useAuthStore.getState().logout();
    scopedWindow.addEventListener('server-version-update', version);
    scopedWindow.addEventListener('server-plugin-support-update', plugin);
    scopedWindow.addEventListener('unauthorized', unauthorized);
    return () => { scopedWindow.removeEventListener('server-version-update', version); scopedWindow.removeEventListener('server-plugin-support-update', plugin); scopedWindow.removeEventListener('unauthorized', unauthorized); };
  }, []);
  return null;
}
