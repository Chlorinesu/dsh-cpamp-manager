/** Non-secret, browser-local preference. The upstream application storage stays isolated. */
export const APPEARANCE_KEY = '@local/cpamp-monitor/appearance-v1';
export const DEFAULT_APPEARANCE = 'mist';
export const APPEARANCE_IDS = Object.freeze(['mist', 'ice', 'sand', 'host']);
export const normalizeAppearance = value => APPEARANCE_IDS.includes(value) ? value : DEFAULT_APPEARANCE;
export function loadAppearance(storage) {
  try { return normalizeAppearance(storage?.getItem(APPEARANCE_KEY)); } catch { return DEFAULT_APPEARANCE; }
}
export function saveAppearance(storage, value) {
  const id = normalizeAppearance(value);
  try { if (!storage) return false; storage.setItem(APPEARANCE_KEY, id); return true; } catch { return false; }
}
/** Page background < raised card < nested control: each preset has its own hierarchy. */
export const surfacePalettes = Object.freeze({
  mist: Object.freeze({
    white: Object.freeze({ base: '#edf0f4', card: '#ffffff', nested: '#f6f8fb', overlay: '#ffffff', border: '#d4dce6', strongBorder: '#b4c0d0', text: '#202b3b', secondary: '#526278', idle: '#65748a' }),
    dark: Object.freeze({ base: '#101720', card: '#1d2836', nested: '#263446', overlay: '#243244', border: '#3d5067', strongBorder: '#536b87', text: '#e6edf7', secondary: '#afbed0', idle: '#91a4ba' }),
  }),
  ice: Object.freeze({
    white: Object.freeze({ base: '#e9f0fa', card: '#ffffff', nested: '#f3f7fd', overlay: '#ffffff', border: '#cbd9ed', strongBorder: '#adc3df', text: '#1e304a', secondary: '#4e6480', idle: '#647995' }),
    dark: Object.freeze({ base: '#0e192b', card: '#1a2c45', nested: '#233a56', overlay: '#213650', border: '#395a7f', strongBorder: '#5076a1', text: '#e3edfc', secondary: '#aabfda', idle: '#8fa8c8' }),
  }),
  sand: Object.freeze({
    white: Object.freeze({ base: '#eeeae4', card: '#fffefa', nested: '#f7f4ee', overlay: '#fffefa', border: '#d9d0c3', strongBorder: '#bdb1a0', text: '#34312d', secondary: '#686055', idle: '#7e7468' }),
    dark: Object.freeze({ base: '#1b1815', card: '#2d2822', nested: '#393229', overlay: '#363027', border: '#574d40', strongBorder: '#746653', text: '#f2eadf', secondary: '#c3b7a7', idle: '#ac9d89' }),
  }),
});
export function surfaceThemeCss() {
  const aliases = { base: 'bg-base', card: 'bg-layer-1', nested: 'bg-layer-2', overlay: 'bg-overlay', border: 'border-l1', strongBorder: 'border-l2', text: 'label-primary', secondary: 'label-secondary', idle: 'state-idle-primary' };
  return Object.entries(surfacePalettes).flatMap(([id, modes]) => Object.entries(modes).map(([mode, palette]) => {
    const selector = `.cpamp-admin[data-palette="${id}"]${mode === 'dark' ? '[data-theme="dark"]' : ''}`;
    const declarations = Object.entries(palette).map(([key, value]) => `--dsw-alias-${aliases[key]}:${value}`).join(';');
    const accent = mode === 'dark' ? '#60a5fa' : '#1d4ed8';
    return `${selector}{${declarations};--dsw-alias-brand-primary:${accent};color-scheme:${mode === 'dark' ? 'dark' : 'light'}}`;
  })).join('\n');
}
