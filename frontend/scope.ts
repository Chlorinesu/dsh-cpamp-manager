/* Component-owned environment for the ported application; never patches browser globals. */
let root: HTMLElement | null = null;
let readHostColorScheme: (() => 'light' | 'dark' | undefined) | null = null;
export function refreshScopeTheme() {
  if (!root) return;
  let scheme: 'light' | 'dark' | undefined;
  try { scheme = readHostColorScheme?.(); } catch { /* Fall back to the Host, never the locally recolored root. */ }
  if (!scheme) {
    const tree = root.getRootNode();
    const host = typeof ShadowRoot !== 'undefined' && tree instanceof ShadowRoot ? tree.host : globalThis.document.documentElement;
    const styles = globalThis.getComputedStyle(host);
    const token = styles.getPropertyValue('--dsw-alias-bg-base').trim();
    let channels: number[] | undefined;
    if (/^#[0-9a-f]{6}$/i.test(token)) channels = token.slice(1).match(/../g)?.map(v => parseInt(v, 16));
    else if (/^#[0-9a-f]{3}$/i.test(token)) channels = [...token.slice(1)].map(v => parseInt(v + v, 16));
    else if (/^rgb/i.test(token)) channels = token.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
    const dark = channels?.length === 3 ? channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 < 128 : globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
    scheme = dark ? 'dark' : 'light';
  }
  const value = scheme === 'dark' ? 'dark' : 'white';
  if (root.getAttribute('data-theme') !== value) root.setAttribute('data-theme', value);
}
let serviceBase = 'https://cpamp.example.invalid';
let route = '/';
let routeSearch = '';
let fetchHandler: typeof globalThis.fetch | null = null;
const localValues = new Map<string, string>();
const sessionValues = new Map<string, string>();
const localEvents = new EventTarget();
function scopedActiveElement(): Element | null {
  const tree = root?.getRootNode();
  return typeof ShadowRoot !== 'undefined' && tree instanceof ShadowRoot ? tree.activeElement : globalThis.document.activeElement;
}
const disposers = new Set<() => void>();
const mediaUpdates = new Set<() => void>();
function scopeMatchMedia(query: string): MediaQueryList {
  const width = query.match(/^\(\s*(min|max)-width\s*:\s*([\d.]+)px\s*\)$/i);
  if (!width) return globalThis.window.matchMedia(query);
  const matches = () => width[1].toLowerCase() === 'max' ? (root?.clientWidth ?? globalThis.window.innerWidth) <= Number(width[2]) : (root?.clientWidth ?? globalThis.window.innerWidth) >= Number(width[2]);
  const target = new EventTarget(); let previous = matches();
  const result = Object.assign(target, { media: query, onchange: null as ((event: MediaQueryListEvent) => void) | null, addListener(listener: EventListener) { target.addEventListener('change', listener); }, removeListener(listener: EventListener) { target.removeEventListener('change', listener); } });
  Object.defineProperty(result, 'matches', { get: matches });
  const update = () => { const next = matches(); if (next !== previous) { previous = next; const event = new MediaQueryListEvent('change', { media: query, matches: next }); target.dispatchEvent(event); result.onchange?.(event); } };
  mediaUpdates.add(update); disposers.add(() => mediaUpdates.delete(update));
  return result as unknown as MediaQueryList;
}

function memoryStorage(values: Map<string, string>): Storage {
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)); },
    removeItem: (key: string) => { values.delete(String(key)); },
    clear: () => values.clear(),
  };
}
export const scopedLocalStorage = memoryStorage(localValues);
export const scopedSessionStorage = memoryStorage(sessionValues);
export function getScopeRoot(): HTMLElement {
  if (!root) throw new Error('CPAMP panel is not mounted.');
  return root;
}
export function setScopeFetch(handler: typeof globalThis.fetch | null) { fetchHandler = handler; }
export const scopedFetch: typeof globalThis.fetch = (input, init) => {
  if (!fetchHandler) return Promise.reject(new Error('CPAMP transport is not active.'));
  return fetchHandler(input, init);
};
export function setScopeBaseUrl(baseUrl: string) { serviceBase = baseUrl.replace(/\/+$/, ''); }
export function scopeRect(element: Element): DOMRect {
  const rect = element.getBoundingClientRect();
  const origin = root?.getBoundingClientRect();
  return new DOMRect(rect.x - (origin?.x ?? 0), rect.y - (origin?.y ?? 0), rect.width, rect.height);
}
export function scopeCoordinate(event: Record<string, number>, key: string): number {
  const rect = root?.getBoundingClientRect();
  return event[key] - (key.endsWith('X') ? rect?.left ?? 0 : rect?.top ?? 0);
}
export function setScopeRoute(pathname: string, search = '') {
  const previous = '#' + route + routeSearch;
  route = pathname.startsWith('/') ? pathname : '/' + pathname;
  routeSearch = search ? (search.startsWith('?') ? search : '?' + search) : '';
  if (previous !== '#' + route + routeSearch) localEvents.dispatchEvent(new Event('hashchange'));
}
const locationView = new Proxy({} as Location, {
  get(_target, key) {
    const value = new URL('management.html', serviceBase + '/');
    value.hash = route + routeSearch;
    if (key === 'hash') return '#' + route + routeSearch;
    if (key === 'reload') return () => localEvents.dispatchEvent(new Event('cpamp:reload'));
    if (key === 'assign' || key === 'replace') return (url: string) => {
      if (String(url).startsWith('#')) { const parsed = new URL(String(url), value); setScopeRoute(parsed.hash.slice(1).split('?')[0], parsed.hash.includes('?') ? parsed.hash.slice(parsed.hash.indexOf('?')) : ''); return; }
      const next = new URL(url, value); if (['https:', 'http:'].includes(next.protocol)) globalThis.window.open(next.href, '_blank', 'noopener,noreferrer');
    };
    if (key === 'toString') return () => value.href;
    const result = Reflect.get(value, key); return typeof result === 'function' ? result.bind(value) : result;
  },
  set(_target, key, value) {
    if (key === 'hash') { const hash = String(value).replace(/^#/, ''); const idx = hash.indexOf('?'); setScopeRoute(idx < 0 ? hash : hash.slice(0, idx), idx < 0 ? '' : hash.slice(idx)); return true; }
    if (key === 'href') { locationView.assign(String(value)); return true; }
    return false;
  },
});
let navigateHistory: ((delta: number) => void) | null = null;
export function setScopeNavigator(navigate: ((delta: number) => void) | null) { navigateHistory = navigate; }
const localHistory = {
  state: { idx: 0 } as unknown,
  length: 1,
  scrollRestoration: 'manual',
  pushState(data: unknown, _unused: string, url?: string | URL | null) { this.state = data; this.length += 1; if (url) locationView.assign(String(url).startsWith('#') ? String(url) : new URL(String(url), locationView.href).hash || '#/'); },
  replaceState(data: unknown, _unused: string, url?: string | URL | null) { this.state = data; if (url) locationView.assign(String(url).startsWith('#') ? String(url) : new URL(String(url), locationView.href).hash || '#/'); },
  go(delta = 0) { if (delta) navigateHistory?.(delta); },
  back() { navigateHistory?.(-1); }, forward() { navigateHistory?.(1); },
};
const customEvent = (name: string) => !['resize', 'online', 'offline', 'scroll', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'focus', 'blur', 'visibilitychange', 'beforeunload', 'message'].includes(name);
const registrations = new Map<string, Map<EventListenerOrEventListenerObject, () => void>>();
function listen(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
  if (!listener) return;
  const wrapped: EventListener = event => {
    if (!root) return;
    if (['keydown', 'keyup'].includes(type) && (root.dataset.connectionSettings === 'open' || !root.contains(scopedActiveElement()))) return;
    const originalTarget = event.composedPath?.()[0] ?? event.target;
    const localEvent = new Proxy(event, { get(value, property) { if (property === 'target') return originalTarget; const field = Reflect.get(value, property, value); return typeof field === 'function' ? field.bind(value) : field; } });
    if (typeof listener === 'function') listener.call(target, localEvent); else listener.handleEvent(localEvent);
  };
  target.addEventListener(type, wrapped, options);
  const key = (target === globalThis.window ? 'window:' : target === globalThis.document ? 'document:' : 'local:') + type;
  const group = registrations.get(key) ?? new Map();
  const dispose = () => { target.removeEventListener(type, wrapped, options); group.delete(listener); disposers.delete(dispose); };
  group.get(listener)?.(); group.set(listener, dispose); registrations.set(key, group); disposers.add(dispose);
}
function unlisten(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null) {
  if (!listener) return;
  const key = (target === globalThis.window ? 'window:' : target === globalThis.document ? 'document:' : 'local:') + type;
  registrations.get(key)?.get(listener)?.();
}
export const scopedDocument = new Proxy({} as Document, {
  get(_target, key) {
    if (key === 'body' || key === 'documentElement' || key === 'scrollingElement') return getScopeRoot();
    if (key === 'activeElement') return scopedActiveElement();
    if (key === 'head') { const tree = getScopeRoot().getRootNode(); return typeof ShadowRoot !== 'undefined' && tree instanceof ShadowRoot ? tree : getScopeRoot(); }
    if (key === 'hasFocus') return () => getScopeRoot().contains(scopedActiveElement());
    if (key === 'defaultView') return scopedWindow;
    if (key === 'elementFromPoint') return (x: number, y: number) => { const origin = root?.getBoundingClientRect(); const found = globalThis.document.elementFromPoint(x + (origin?.left ?? 0), y + (origin?.top ?? 0)); return found && root?.contains(found) ? found : null; };
    if (key === 'querySelector') return (selector: string) => getScopeRoot().matches(selector) ? getScopeRoot() : getScopeRoot().querySelector(selector);
    if (key === 'querySelectorAll') return (selector: string) => getScopeRoot().querySelectorAll(selector);
    if (key === 'getElementById') return (id: string) => getScopeRoot().querySelector('[id="' + CSS.escape(id) + '"]');
    if (key === 'getElementsByClassName') return (name: string) => getScopeRoot().getElementsByClassName(name);
    if (key === 'addEventListener') return (type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions) => listen(globalThis.document, type, listener, options);
    if (key === 'removeEventListener') return (type: string, listener: EventListenerOrEventListenerObject) => unlisten(globalThis.document, type, listener);
    if (key === 'location') return locationView;
    const value = Reflect.get(globalThis.document, key, globalThis.document);
    return typeof value === 'function' ? value.bind(globalThis.document) : value;
  },
  set(_target, key, value) {
    if (key === 'title') { getScopeRoot().setAttribute('aria-label', String(value)); return true; }
    if (key === 'location') { locationView.assign(String(value)); return true; }
    return false;
  },
});
export const scopedWindow = new Proxy({} as Window & typeof globalThis, {
  get(_target, key) {
    if (key === 'document') return scopedDocument;
    if (key === 'window' || key === 'self' || key === 'parent' || key === 'top') return scopedWindow;
    if (key === 'history') return localHistory;
    if (key === 'location') return locationView;
    if (key === 'localStorage') return scopedLocalStorage;
    if (key === 'sessionStorage') return scopedSessionStorage;
    if (key === 'fetch') return scopedFetch;
    if (key === 'matchMedia') return scopeMatchMedia;
    if (key === 'innerWidth') return root?.clientWidth ?? globalThis.window.innerWidth;
    if (key === 'innerHeight') return root?.clientHeight ?? globalThis.window.innerHeight;
    if (key === 'scrollX' || key === 'pageXOffset') return root?.scrollLeft ?? 0;
    if (key === 'scrollY' || key === 'pageYOffset') return root?.scrollTop ?? 0;
    if (key === 'scrollTo' || key === 'scroll') return (...args: unknown[]) => (getScopeRoot().scrollTo as Function).apply(getScopeRoot(), args);
    if (key === 'addEventListener') return (type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions) => listen(customEvent(type) ? localEvents : globalThis.window, type, listener, options);
    if (key === 'removeEventListener') return (type: string, listener: EventListenerOrEventListenerObject) => unlisten(customEvent(type) ? localEvents : globalThis.window, type, listener);
    if (key === 'dispatchEvent') return (event: Event) => localEvents.dispatchEvent(event);
    const value = Reflect.get(globalThis.window, key, globalThis.window);
    return typeof value === 'function' ? value.bind(globalThis.window) : value;
  },
  set(_target, key, value) {
    if (key === 'location') { locationView.assign(String(value)); return true; }
    // Deliberately refuse application-global mutations from the vendored UI.
    return false;
  },
});
export function mountScope(element: HTMLElement, readColorScheme?: () => 'light' | 'dark' | undefined) {
  if (root && root !== element) unmountScope();
  root = element;
  readHostColorScheme = readColorScheme ?? null;
  const updateGeometry = () => {
    if (!root) return;
    const rect = root.getBoundingClientRect();
    root.style.setProperty('--cpamp-root-top', rect.top + 'px'); root.style.setProperty('--cpamp-root-left', rect.left + 'px');
    root.style.setProperty('--cpamp-root-width', rect.width + 'px'); root.style.setProperty('--cpamp-root-height', rect.height + 'px');
    for (const update of mediaUpdates) update();
  };
  updateGeometry();
  const resize = new ResizeObserver(updateGeometry); resize.observe(element); disposers.add(() => resize.disconnect());
  globalThis.window.addEventListener('resize', updateGeometry); disposers.add(() => globalThis.window.removeEventListener('resize', updateGeometry));
  refreshScopeTheme();
  const observer = new MutationObserver(refreshScopeTheme);
  observer.observe(globalThis.document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  disposers.add(() => observer.disconnect());
  return () => { if (root === element) unmountScope(); };
}
export function unmountScope() {
  for (const dispose of [...disposers]) dispose();
  disposers.clear(); registrations.clear(); fetchHandler = null; navigateHistory = null; readHostColorScheme = null; root = null;
}
