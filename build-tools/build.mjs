import * as esbuild from 'esbuild';
import * as sass from 'sass';
import ts from 'typescript';
import { readFile, writeFile, mkdir, access, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scopeCss } from './scope-css.mjs';
import { accentThemeCss } from '../frontend/palette.mjs';
import { surfaceThemeCss } from '../frontend/appearance.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const upstream = path.join(root, 'upstream/src');
const frontend = path.join(root, 'frontend');
const normalized = value => value.replaceAll('\\', '/');
const overrideRows = [
  ['stores/useAuthStore.ts', 'auth.ts'],
  ['app/AppLifecycle.tsx', 'lifecycle.tsx'],
  ['app/AppRouter.tsx', 'router.tsx'],
  ['services/api/client.ts', 'adapters/api-client.ts'],
  ['stores/useThemeStore.ts', 'adapters/useThemeStore.ts'],
  ['features/plugins/PluginResourcePage.tsx', 'adapters/PluginResourcePage.tsx'],
  ['features/system/ManagerUpdates.tsx', 'adapters/ManagerUpdates.tsx'],
];
const overrides = new Map();
for (const [from, to] of overrideRows) {
  try { await access(path.join(frontend, to)); overrides.set(normalized(path.join(upstream, from)), path.join(frontend, to)); } catch {}
}
// Match upstream's production build: never ship its fictional demo fixtures.
overrides.set(normalized(path.join(upstream, 'features/demo/demoFixtures.ts')), path.join(upstream, 'features/demo/demoFixtures.empty.ts'));
const resolveSourceFile = async name => {
  for (const candidate of [name, name + '.ts', name + '.tsx', name + '.js', path.join(name, 'index.ts'), path.join(name, 'index.tsx')]) {
    try { if ((await stat(candidate)).isFile()) return candidate; } catch {}
  }
  return name;
};
function adaptSource(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const transformed = ts.transform(file, [context => {
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'getBoundingClientRect' && node.arguments.length === 0) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('__cpampRect'), undefined, [ts.visitNode(node.expression.expression, visit)]);
      }
      if (ts.isPropertyAccessExpression(node) && ['clientX', 'clientY', 'pageX', 'pageY'].includes(node.name.text) && !(ts.isBinaryExpression(node.parent) && node.parent.left === node)) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('__cpampCoordinate'), undefined, [ts.visitNode(node.expression, visit), ts.factory.createStringLiteral(node.name.text)]);
      }
      // Preserve upstream chart/artwork palettes, their light/dark variants and hex alpha.
      // Resolving constants against the current Host theme here collapses series colors
      // and breaks upstream helpers that append hex alpha or choose a palette later.
      return ts.visitEachChild(node, visit, context);
    };
    return tree => ts.visitNode(tree, visit);
  }]);
  const printed = ts.createPrinter().printFile(transformed.transformed[0]); transformed.dispose();
  const header = `import { scopedDocument as document, scopedWindow as window, scopedLocalStorage as localStorage, scopedSessionStorage as sessionStorage, scopedFetch as fetch, scopeRect as __cpampRect, scopeCoordinate as __cpampCoordinate } from ${JSON.stringify(path.join(frontend, 'scope.ts'))};\n`;
  return header + printed;
}
const buildResult = await esbuild.build({
  entryPoints: [path.join(frontend, 'entry.tsx')],
  absWorkingDir: root, outdir: path.join(root, 'dist'), entryNames: 'admin',
  bundle: true, write: false, format: 'cjs', platform: 'browser', target: ['es2022'],
  jsx: 'automatic', minify: true, sourcemap: false, metafile: true,
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'],
  nodePaths: [path.join(here, 'node_modules')],
  define: { __APP_VERSION__: JSON.stringify('v1.14.10-harness'), __DEMO_SITE__: 'false', 'process.env.NODE_ENV': JSON.stringify('production') },
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' },
  plugins: [{ name: 'cpamp-native-adaptation', setup(build) {
    build.onResolve({ filter: /^@\// }, async args => {
      const resolved = await resolveSourceFile(path.join(upstream, args.path.slice(2)));
      return { path: overrides.get(normalized(resolved)) ?? resolved };
    });
    build.onResolve({ filter: /^\./ }, async args => {
      if (!args.importer || !normalized(args.importer).startsWith(normalized(upstream) + '/')) return;
      const resolved = await resolveSourceFile(path.resolve(args.resolveDir, args.path));
      const replacement = overrides.get(normalized(resolved));
      return replacement ? { path: replacement } : undefined;
    });
    build.onLoad({ filter: /\.(tsx?|jsx?)$/ }, async args => {
      if (!normalized(args.path).startsWith(normalized(upstream) + '/')) return;
      if (/\.(test|spec)\./.test(args.path)) throw new Error('Test modules must not be bundled');
      const source = await readFile(args.path, 'utf8');
      return { contents: adaptSource(source, args.path), loader: args.path.endsWith('tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) };
    });
    build.onLoad({ filter: /\.scss$/ }, async args => {
      const header = '@use "@/styles/variables" as *;\n@use "@/styles/mixins" as *;\n';
      const result = sass.compileString(header + await readFile(args.path, 'utf8'), {
        url: pathToFileURL(args.path), style: 'expanded', quietDeps: true, silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin', 'color-functions'],
        importers: [{ findFileUrl(url) { return url.startsWith('@/') ? pathToFileURL(path.join(upstream, url.slice(2))) : null; } }],
      });
      return { contents: result.css, loader: args.path.endsWith('.module.scss') ? 'local-css' : 'css', resolveDir: path.dirname(args.path) };
    });
  } }],
});
const js = buildResult.outputFiles.find(file => file.path.endsWith('.js'))?.text;
if (!js) throw new Error('Build produced no client JavaScript');
const rawCss = buildResult.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const css = await scopeCss(rawCss) + '\n' + await readFile(path.join(frontend, 'host-theme.css'), 'utf8') + '\n' + accentThemeCss() + '\n' + surfaceThemeCss();
const wrapped = `window.__ModuleLoader__.load({id:'dsh-cpamp-manager',factory(require){\nconst __CPAMP_STYLES__=${JSON.stringify(css)};\nconst module={exports:{}};const exports=module.exports;\n${js}\nreturn module.exports;\n}});\n`;
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/client.js'), wrapped);
const dependencyPackages = [...new Set(Object.keys(buildResult.metafile.inputs).filter(name => name.includes('node_modules/')).map(name => {
  const segments = normalized(name).split('node_modules/').at(-1).split('/');
  return segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}))].sort();
const notices = ['Bundled browser dependencies for the native CPAMP adaptation.\nCPAMP upstream license is retained separately in upstream/LICENSE.\n'];
for (const name of dependencyPackages) {
  const directory = path.join(here, 'node_modules', name);
  try {
    const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    notices.push(`\n${'='.repeat(72)}\n${name}@${pkg.version}\nDeclared license: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}\n`);
    let found = false;
    for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.txt', 'LICENCE', 'LICENSE-MIT', 'LICENSE-MIT.txt', 'License']) {
      try { notices.push(await readFile(path.join(directory, candidate), 'utf8')); found = true; break; } catch {}
    }
    for (const candidate of ['NOTICE', 'NOTICE.txt']) { try { notices.push(await readFile(path.join(directory, candidate), 'utf8')); } catch {} }
    if (!found && ['@uiw/react-codemirror', '@uiw/codemirror-extensions-basic-setup'].includes(name) && pkg.repository?.url === 'https://github.com/uiwjs/react-codemirror.git' && pkg.license === 'MIT') {
      notices.push(await readFile(path.join(root, 'upstream/licenses/react-codemirror.SOURCE'), 'utf8'));
      notices.push(await readFile(path.join(root, 'upstream/licenses/react-codemirror.LICENSE'), 'utf8')); found = true;
    }
    if (!found) throw new Error('No redistributable license text found for ' + name);
  } catch (error) { throw new Error('Dependency attribution failed: ' + name + ' (' + error.message + ')'); }
}
await writeFile(path.join(root, 'upstream/DEPENDENCY_LICENSES.txt'), notices.join('\n'));
const authoringHashes = {};
for (const name of [...Object.keys(buildResult.metafile.inputs).filter(name => name.startsWith('frontend/') || name === 'admin-policy.js'), 'build-tools/build.mjs', 'build-tools/scope-css.mjs', 'frontend/host-theme.css', 'frontend/palette.mjs']) {
  authoringHashes[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
}
await writeFile(path.join(root, 'dist/build-report.json'), JSON.stringify({ upstream: 'v1.14.10', authoringHashes, dependencyPackages, sourceModules: Object.keys(buildResult.metafile.inputs).length, artifactBytes: Buffer.byteLength(wrapped), cssBytes: Buffer.byteLength(css), externalRequests: [...new Set(Object.values(buildResult.metafile.outputs).flatMap(out => out.imports.filter(i => i.external).map(i => i.path)))], bundledSources: Object.keys(buildResult.metafile.inputs).filter(name => name.startsWith('upstream/src/')).sort() }, null, 2));
console.log(`Native CPAMP client: ${Buffer.byteLength(wrapped)} bytes, ${Object.keys(buildResult.metafile.inputs).length} input modules`);
