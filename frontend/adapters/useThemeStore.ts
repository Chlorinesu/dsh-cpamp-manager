import { create } from 'zustand';
import type { Theme } from '@/types';
import { scopedDocument } from '../scope';
interface ThemeState { theme: Theme; resolvedTheme: 'light' | 'dark'; setTheme: (theme: Theme) => void; cycleTheme: () => void; initializeTheme: () => () => void }
const inherited = () => scopedDocument.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: 'auto', resolvedTheme: 'light',
  setTheme(theme) {
    const resolvedTheme = theme === 'auto' ? inherited() : theme === 'dark' ? 'dark' : 'light';
    if (theme !== 'auto') scopedDocument.documentElement.setAttribute('data-theme', resolvedTheme === 'dark' ? 'dark' : 'white');
    set({ theme, resolvedTheme });
  },
  cycleTheme() { const order: Theme[] = ['auto', 'white', 'dark']; get().setTheme(order[(order.indexOf(get().theme) + 1) % order.length]); },
  initializeTheme() {
    set({ theme: 'auto', resolvedTheme: inherited() });
    const observer = new MutationObserver(() => { if (get().theme === 'auto') set({ resolvedTheme: inherited() }); });
    observer.observe(scopedDocument.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  },
}));
