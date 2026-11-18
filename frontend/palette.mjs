/** CPAMP-local palette requested by the user. Never overrides the Harness document. */
export const accentPalettes = Object.freeze({
  white: Object.freeze({
    accent: '#2563eb', hover: '#1d4ed8', solid: '#2563eb', solidHover: '#1d4ed8', solidActive: '#1e40af', onSolid: '#ffffff',
    blue: '#3b82f6', violet: '#8b5cf6', cyan: '#0891b2', teal: '#0d9488', emerald: '#059669',
  }),
  dark: Object.freeze({
    accent: '#60a5fa', hover: '#93c5fd', solid: '#60a5fa', solidHover: '#93c5fd', solidActive: '#60a5fa', onSolid: '#08111f',
    blue: '#60a5fa', violet: '#a78bfa', cyan: '#22d3ee', teal: '#2dd4bf', emerald: '#34d399',
  }),
});
export function accentThemeCss() {
  const declarations = palette => [
    `--dsw-alias-brand-primary:${palette.accent}`,
    `--cpamp-accent-hover:${palette.hover}`,
    `--cpamp-solid:${palette.solid}`,
    `--cpamp-solid-hover:${palette.solidHover}`,
    `--cpamp-solid-active:${palette.solidActive}`,
    `--cpamp-on-solid:${palette.onSolid}`,
    '--cpamp-on-badge:#08111f',
    ...['blue', 'violet', 'cyan', 'teal', 'emerald'].map(name => `--cpamp-chart-${name}:${palette[name]}`),
  ].join(';');
  return `.cpamp-admin{${declarations(accentPalettes.white)}}\n.cpamp-admin[data-theme="dark"]{${declarations(accentPalettes.dark)}}\n`;
}
/** CSS hue classification. Canvas series keep the original upstream palettes. */
export function colorFamily(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), spread = max - min;
  if (spread < 30 || max === 0 || spread / max < .16) return 'neutral';
  const hue = ((max === r ? (g - b) / spread + (g < b ? 6 : 0) : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4) * 60 + 360) % 360;
  return hue < 28 || hue >= 335 ? 'error' : hue < 78 ? 'warn' : hue < 152 ? 'success' : hue < 174 ? 'teal' : hue < 200 ? 'cyan' : hue < 255 ? 'blue' : 'violet';
}
