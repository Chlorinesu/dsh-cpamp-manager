import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { colorFamily } from '../frontend/palette.mjs';

const SCOPE = 'cpamp-admin';
const host = key => key.startsWith('chart-') ? `var(--cpamp-${key})` : `var(--dsw-alias-${key})`;
const tint = (key, alpha) => alpha >= 1 ? host(key) : `color-mix(in srgb, ${host(key)} ${Math.round(alpha * 10000) / 100}%, transparent)`;
const exact = {
  '--app-bg': host('bg-base'), '--app-bg-gradient': 'none',
  '--app-surface': host('bg-layer-1'), '--app-surface-strong': host('bg-layer-1'), '--app-surface-muted': host('bg-layer-2'),
  '--app-border': host('border-l1'), '--app-border-strong': host('border-l2'),
  '--app-text-primary': host('label-primary'), '--app-text-regular': host('label-secondary'), '--app-text-muted': host('label-secondary'),
  '--app-accent': host('brand-primary'), '--app-accent-soft': tint('brand-primary', .10),
  '--surface-subtle': host('bg-layer-2'), '--surface-subtle-hover': tint('brand-primary', .08), '--surface-subtle-strong': host('bg-layer-2'),
  '--border-subtle': host('border-l1'), '--border-subtle-dashed': host('border-l1'),
  '--sidebar-bg-color': host('bg-layer-1'), '--sidebar-logo-bg-color': host('bg-layer-1'),
  '--sidebar-text-color': host('label-secondary'), '--sidebar-active-text-color': host('label-primary'), '--sidebar-hover-bg-color': tint('brand-primary', .10),
  '--glass-bg': host('bg-layer-1'), '--glass-bg-secondary': host('bg-layer-2'), '--glass-border': host('border-l1'),
  '--app-input-bg': host('bg-base'), '--app-input-bg-focus': host('bg-base'), '--app-input-border': host('border-l1'), '--app-input-border-focus': host('brand-primary'),
  '--bg-primary': host('bg-layer-1'), '--bg-secondary': host('bg-base'), '--bg-tertiary': host('bg-layer-2'), '--bg-hover': host('bg-layer-2'), '--bg-quinary': host('bg-layer-2'), '--bg-error-light': tint('state-error-primary', .10),
  '--floating-surface': host('bg-overlay'), '--floating-border': host('border-l1'),
  '--text-primary': host('label-primary'), '--text-secondary': host('label-secondary'), '--text-tertiary': host('label-secondary'), '--text-quaternary': host('state-idle-primary'), '--text-muted': host('label-secondary'),
  '--border-color': host('border-l1'), '--border-secondary': host('border-l1'), '--border-primary': host('border-l2'), '--border-hover': host('brand-primary'),
  '--primary-contrast': host('bg-base'), '--primary-gradient': host('brand-primary'), '--primary-solid': host('brand-primary'), '--primary-solid-hover': host('brand-primary'), '--primary-solid-active': host('brand-primary'),
  '--primary-color': host('brand-primary'), '--primary-hover': host('brand-primary'), '--primary-active': host('brand-primary'), '--primary-soft': tint('brand-primary', .16), '--primary-subtle': tint('brand-primary', .08), '--primary-ring': tint('brand-primary', .25),
  '--focus-bg': tint('brand-primary', .08), '--focus-border': host('brand-primary'), '--focus-inset': tint('brand-primary', .25), '--focus-text': host('brand-primary'),
  '--success-color': host('state-success-primary'), '--quota-medium-color': host('state-warn-primary'), '--warning-color': host('state-warn-primary'), '--error-color': host('state-error-primary'), '--danger-color': host('state-error-primary'), '--info-color': host('label-secondary'),
  '--data-track-bg': host('bg-layer-2'), '--data-health-warn-base': host('state-warn-primary'), '--accent-tertiary': tint('brand-primary', .10),
  '--app-shadow': 'none', '--app-shadow-soft': 'none', '--sidebar-shadow': 'none', '--glass-shadow': 'none', '--floating-shadow': 'none', '--shadow': 'none', '--shadow-lg': 'none',
};
const palette = {
  blue: 'chart-blue', violet: 'chart-violet', cyan: 'chart-cyan', teal: 'chart-teal', emerald: 'chart-emerald', green: 'state-success-primary',
  amber: 'state-warn-primary', red: 'state-error-primary', slate: 'label-secondary', primary: 'brand-primary', success: 'state-success-primary', warning: 'state-warn-primary', danger: 'state-error-primary', error: 'state-error-primary', info: 'label-secondary', neutral: 'label-secondary', failure: 'state-error-primary', count: 'brand-primary',
};
function themedVariable(prop) {
  if (Object.hasOwn(exact, prop)) return exact[prop];
  let match = prop.match(/^--(?:data-|color-)([a-z]+)(?:-(base|dark-2|light-[35789]))?$/);
  if (match && palette[match[1]]) {
    const suffix = match[2] ?? 'base';
    const alpha = { 'light-3': .65, 'light-5': .45, 'light-7': .26, 'light-8': .16, 'light-9': .09 }[suffix] ?? 1;
    return tint(palette[match[1]], alpha);
  }
  match = prop.match(/^--(?:data-badge-)?(success|warning|danger|info|neutral|failure|count)(?:-badge)?-(bg|text|border)$/);
  if (match) return tint(palette[match[1]], { bg: .10, border: .28, text: 1 }[match[2]]);
  if (/^--app-bg-blob-\d-(?:start|end)$/.test(prop)) return host('brand-primary');
  return null;
}
function insideKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === 'atrule' && /(?:^|-)keyframes$/i.test(p.name)) return true;
  return false;
}
const rootNode = node => (node.type === 'tag' && ['html', 'body'].includes(node.value.toLowerCase())) || (node.type === 'id' && node.value === 'root') || (node.type === 'pseudo' && node.value === ':root') || (node.type === 'class' && node.value === SCOPE);
const rootAttribute = node => node.type === 'attribute' && ['data-theme', 'data-visual-effects'].includes(node.attribute);
function rootOnly(selector) {
  let anchored = false, safe = true;
  selector.each(node => {
    if (rootNode(node) || rootAttribute(node)) anchored = true;
    else if (node.type === 'combinator') { if (/[+~]/.test(node.value)) safe = false; }
    else if (!['class', 'comment'].includes(node.type)) safe = false;
  });
  return anchored && safe;
}
function scopeSelectors(text) {
  return selectorParser(ast => {
    for (const selector of [...ast.nodes]) {
      selector.walk(node => {
        if (rootNode(node) && !(node.type === 'class' && node.value === SCOPE)) node.replaceWith(selectorParser.className({ value: SCOPE }));
      });
      const firstCompound = [];
      for (const node of selector.nodes) { if (node.type === 'combinator') break; firstCompound.push(node); }
      let anchored = firstCompound.some(node => node.type === 'class' && node.value === SCOPE);
      if (!anchored && firstCompound.some(rootAttribute)) { selector.prepend(selectorParser.className({ value: SCOPE })); anchored = true; }
      // html > body > #root are one embedded root, not three nested elements.
      if (anchored) {
        let index = selector.nodes.findIndex(node => node.type === 'combinator');
        while (index >= 0) {
          const combinator = selector.nodes[index];
          const next = []; for (let i = index + 1; i < selector.nodes.length && selector.nodes[i].type !== 'combinator'; i++) next.push(selector.nodes[i]);
          if (!next.some(node => node.type === 'class' && node.value === SCOPE)) break;
          if (/[+~]/.test(combinator.value)) throw new Error('Unsafe sibling selector after embedded CPAMP document root');
          combinator.remove();
          next.forEach(node => { if (node.type === 'class' && node.value === SCOPE) node.remove(); });
          index = selector.nodes.findIndex(node => node.type === 'combinator');
        }
        const initialCombinator = selector.nodes.find(node => node.type === 'combinator');
        if (initialCombinator && /[+~]/.test(initialCombinator.value)) throw new Error('Unsafe sibling selector after embedded CPAMP document root');
      } else {
        // A functional root selector such as :is(html,body) matches the scope itself.
        const functionalRoot = firstCompound.some(node => node.type === 'pseudo' && [':is', ':where'].includes(node.value) && node.nodes?.some(s => s.nodes?.some(rootNode)));
        if (functionalRoot) {
          const descendant = selector.clone();
          descendant.prepend(selectorParser.combinator({ value: ' ' }));
          descendant.prepend(selectorParser.className({ value: SCOPE }));
          ast.append(descendant);
        } else selector.prepend(selectorParser.combinator({ value: ' ' }));
        selector.prepend(selectorParser.className({ value: SCOPE }));
      }
    }
  }).processSync(text);
}

const named = {
  white: [255,255,255], black: [0,0,0], gray: [128,128,128], grey: [128,128,128], silver: [192,192,192], darkgray: [169,169,169], lightgray: [211,211,211], dimgray: [105,105,105], gainsboro: [220,220,220], whitesmoke: [245,245,245],
  red: [255,0,0], darkred: [139,0,0], firebrick: [178,34,34], crimson: [220,20,60], pink: [255,192,203], hotpink: [255,105,180], salmon: [250,128,114], orange: [255,165,0], darkorange: [255,140,0], coral: [255,127,80], gold: [255,215,0], yellow: [255,255,0], khaki: [240,230,140],
  green: [0,128,0], darkgreen: [0,100,0], lightgreen: [144,238,144], lime: [0,255,0], limegreen: [50,205,50], seagreen: [46,139,87], olive: [128,128,0], teal: [0,128,128], cyan: [0,255,255], aqua: [0,255,255],
  blue: [0,0,255], navy: [0,0,128], royalblue: [65,105,225], skyblue: [135,206,235], lightblue: [173,216,230], steelblue: [70,130,180], purple: [128,0,128], violet: [238,130,238], indigo: [75,0,130], magenta: [255,0,255], fuchsia: [255,0,255], rebeccapurple: [102,51,153], brown: [165,42,42], maroon: [128,0,0],
};
// Remaining standard named colors are still adapted even when no precise RGB
// classification is needed. They never survive as hard-coded CSS fallbacks.
const otherNamedColors = new Set(('aliceblue antiquewhite aquamarine azure beige bisque blanchedalmond blueviolet burlywood cadetblue chartreuse chocolate cornflowerblue cornsilk darkblue darkcyan darkgoldenrod darkgrey darkkhaki darkmagenta darkolivegreen darkorchid darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgrey dodgerblue floralwhite forestgreen ghostwhite goldenrod greenyellow honeydew indianred ivory lavender lavenderblush lawngreen lemonchiffon lightcoral lightcyan lightgoldenrodyellow lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow linen mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite oldlace olivedrab orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru plum powderblue rosybrown saddlebrown sandybrown seashell sienna slateblue slategray slategrey snow springgreen tan thistle tomato turquoise wheat yellowgreen').split(' '));
const systemColors = { canvas: 'bg-base', canvastext: 'label-primary', buttonface: 'bg-layer-1', buttontext: 'label-primary', field: 'bg-base', fieldtext: 'label-primary', graytext: 'label-secondary', highlight: 'brand-primary', highlighttext: 'bg-base', linktext: 'brand-primary', visitedtext: 'brand-primary', activetext: 'brand-primary', selecteditem: 'brand-primary', selecteditemtext: 'bg-base', accentcolor: 'brand-primary', accentcolortext: 'bg-base' };
function namedToHost(key, property) {
  if (named[key]) return colorToHost(named[key], property);
  if (systemColors[key]) return host(systemColors[key]);
  if (!otherNamedColors.has(key)) return null;
  const token = /green|aquamarine|spring|turquoise/.test(key) ? 'state-success-primary' : /yellow|gold|orange|khaki|lemon/.test(key) ? 'state-warn-primary' : /red|pink|salmon|coral|tomato|rose|sienna/.test(key) ? 'state-error-primary' : /white|snow|ivory|cream|lace|linen|beige|gray|grey|slate/.test(key) ? (/background/.test(property) ? 'bg-layer-1' : 'label-secondary') : 'brand-primary';
  return host(token);
}
function rgbFromHex(value) {
  let hex = value.slice(1); if ([3,4].includes(hex.length)) hex = [...hex].map(x => x+x).join('');
  if (![6,8].includes(hex.length)) return null;
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16), hex.length === 8 ? parseInt(hex.slice(6),16)/255 : 1];
}
function functionColor(name, contents) {
  const values = contents.trim().split(/[\s,/]+/).filter(Boolean);
  if (values.some(x => !/^-?[\d.]+(?:%|deg|turn|rad)?$/.test(x))) return null;
  const alphaValue = values[3]; const alpha = alphaValue === undefined ? 1 : parseFloat(alphaValue)/(alphaValue.endsWith('%') ? 100 : 1);
  if (/^rgb/.test(name)) return [...values.slice(0,3).map(v => parseFloat(v)*(v.endsWith('%') ? 2.55 : 1)), alpha];
  if (/^hsl/.test(name)) {
    let hue = parseFloat(values[0]); if (values[0].endsWith('turn')) hue *= 360; else if (values[0].endsWith('rad')) hue *= 180/Math.PI;
    hue = ((hue%360)+360)%360/60; const s = parseFloat(values[1])/100, l = parseFloat(values[2])/100;
    const chroma = (1-Math.abs(2*l-1))*s, x = chroma*(1-Math.abs(hue%2-1)), m=l-chroma/2;
    const rgb = hue<1?[chroma,x,0]:hue<2?[x,chroma,0]:hue<3?[0,chroma,x]:hue<4?[0,x,chroma]:hue<5?[x,0,chroma]:[chroma,0,x];
    return [...rgb.map(v => (v+m)*255),alpha];
  }
  return null;
}
function colorToHost(rgba, property) {
  if (!rgba || rgba.length<3 || rgba.some(x => !Number.isFinite(x))) return host('label-primary');
  const [r,g,b,a=1] = rgba, max=Math.max(r,g,b), min=Math.min(r,g,b), spread=max-min, light=(max+min)/510;
  let token;
  if (spread < 30 || max === 0 || spread/max < .16) {
    if (/shadow/.test(property)) token='label-primary';
    else if (/border|outline|stroke/.test(property)) token='border-l1';
    else if (/background|(?:^|-)bg|surface/.test(property)) token=light>.85?'bg-layer-1':light<.2?'bg-base':'bg-layer-2';
    else token=light>.93?'bg-base':light>.40&&light<.78?'label-secondary':'label-primary';
  } else {
    const family = colorFamily(r, g, b);
    token = family === 'error' ? 'state-error-primary' : family === 'warn' ? 'state-warn-primary' : family === 'success' ? 'state-success-primary' : 'chart-' + family;
    // Very pale status backgrounds remain soft in both Host themes.
    if (/background|(?:^|-)bg|surface/.test(property) && light>.78) return tint(token, Math.min(a,.12));
  }
  return tint(token, Math.max(0,Math.min(1,a)));
}
function matchingParen(value, start) {
  let level=1, quote=null;
  for(let i=start+1;i<value.length;i++) {
    const c=value[i]; if(c==='\\'){i++;continue;}
    if(quote){if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='(')level++; else if(c===')'&&--level===0)return i;
  }
  return value.length-1;
}
function convertColors(value, property) {
  let output='';
  const colorProperty = /color|background|border|shadow|outline|fill|stroke|caret|accent|decoration|^--/.test(property);
  for(let i=0;i<value.length;) {
    const c=value[i];
    if(c==='"'||c==="'") { let end=i+1; while(end<value.length){if(value[end]==='\\'){end+=2;continue;}if(value[end++]===c)break;}output+=value.slice(i,end);i=end;continue; }
    const fn=value.slice(i).match(/^([\w-]+)\(/);
    if(fn) {
      const open=i+fn[1].length, end=matchingParen(value,open), name=fn[1].toLowerCase(), inside=value.slice(open+1,end);
      if(name==='url') output+=value.slice(i,end+1); // Original licensed artwork/data URLs are opaque.
      else if(/^(?:rgba?|hsla?)$/.test(name)) { const rgba=functionColor(name,inside); output+=rgba?colorToHost(rgba,property):host('label-primary'); }
      else if(/^(?:oklch|oklab|lab|lch|hwb|color)$/.test(name)) output+=host(/background/.test(property)?'bg-layer-2':'brand-primary');
      else output+=fn[1]+'('+convertColors(inside,property)+')';
      i=end+1;continue;
    }
    if(c==='#') { const hex=value.slice(i).match(/^#[\da-f]{3,8}(?![\w-])/i); if(hex) { const rgba=rgbFromHex(hex[0]); if(rgba){output+=colorToHost(rgba,property);i+=hex[0].length;continue;} } }
    const word=value.slice(i).match(/^[a-zA-Z_][\w-]*/);
    if(word) { const key=word[0].toLowerCase(); output+=(colorProperty ? namedToHost(key,property) : null) ?? word[0]; i+=word[0].length;continue; }
    output+=c;i++;
  }
  return output;
}
function isRootRule(rule) {
  let result=false;
  selectorParser(ast=>{result=ast.nodes.length>0&&ast.nodes.every(rootOnly);}).processSync(rule.selector);
  return result;
}
function isColorVariable(prop,value) {
  if (!prop.startsWith('--') || /(?:opacity|blur|width|height|gap|radius|padding|size|duration)$/.test(prop)) return false;
  return themedVariable(prop)!==null || convertColors(value,prop)!==value || /(?:bg|surface|text|border|color|gradient|shadow|accent|ring|inset|track)/.test(prop);
}

/** Scope compiled upstream CSS to the embedded panel, preserving at-rule/keyframe structure. */
export function scopeCss(cssText) {
  const root=postcss.parse(cssText), rootColors=new Map(), keyframes=new Map();
  root.walkAtRules(at=>{
    if(/(?:^|-)keyframes$/i.test(at.name)) {const raw=at.params.trim(),quote=/^["']/.test(raw)?raw[0]:'';const original=quote&&raw.endsWith(quote)?raw.slice(1,-1):raw;if(!/^[\w-]+$/.test(original))throw new Error('Unsupported keyframe identifier: '+raw);const name=original.startsWith('cpamp-admin-')?original:'cpamp-admin-'+original;keyframes.set(original,name);at.params=quote+name+quote;}
    if(/^import$/i.test(at.name))throw new Error('Unresolved CSS @import must be bundled before scopeCss');
    if(/^(?:page|viewport|-ms-viewport)$/i.test(at.name))at.remove();
  });
  root.walkRules(rule=>{
    if(insideKeyframes(rule))return;
    const rootRule=isRootRule(rule);
    if(rootRule)rule.walkDecls(decl=>{
      if(isColorVariable(decl.prop,decl.value)) {if(!rootColors.has(decl.prop))rootColors.set(decl.prop,themedVariable(decl.prop)??convertColors(decl.value,decl.prop));decl.remove();}
    });
    rule.selector=scopeSelectors(rule.selector);
    if(rule.nodes.length===0)rule.remove();
  });
  root.walkDecls(decl=>{
    let ancestor=decl.parent;while(ancestor&&ancestor.type!=='atrule')ancestor=ancestor.parent;
    if(ancestor?.name?.toLowerCase()==='font-face')return;
    if(/^(?:-webkit-)?animation(?:-name)?$/.test(decl.prop)) {
      decl.value=decl.value.replace(/(?<![\w-])-{0,2}[A-Za-z_][\w-]*(?![\w-])/g,name=>keyframes.get(name)??name);
    }
    decl.value=convertColors(decl.value,decl.prop);
    // Ranking badges use pale amber/slate backgrounds, not the primary button fill.
    if (decl.prop === 'color' && /\[data-rank\s*=/.test(decl.parent.selector ?? '')) decl.value = 'var(--cpamp-on-badge)';
    // cqw/cqh resolve against the size-contained .cpamp-admin, never the browser viewport.
    if(/^(?:min-|max-)?(?:width|height)$|^(?:inset|top|right|bottom|left|flex-basis|padding|margin|gap|grid-template|--)/.test(decl.prop)) {
      decl.value=decl.value.replace(/\b([\d.]+)(?:d|s|l)?v([wh])\b/g,(_all,n,axis)=>Number(n)===100?'100%':n+(axis==='w'?'cqw':'cqh'));
    }
  });
  if(rootColors.size) {const map=postcss.rule({selector:'.cpamp-admin'});for(const [prop,value]of rootColors)map.append({prop,value});root.append(map);}
  return root.toString();
}
export default scopeCss;
