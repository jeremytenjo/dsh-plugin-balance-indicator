import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = resolve(root, '.build');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const packageId = packageJson.name;
const outfile = resolve(buildDir, 'client.cjs');

await mkdir(buildDir, { recursive: true });

await build({
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120', 'safari17'],
  // React comes from the page's shared module table; TanStack Query is
  // bundled into this artifact because the table does not provide it.
  external: ['react', 'react-dom', 'react-dom/client'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
  entryPoints: [resolve(root, 'src/client.js')],
  outfile,
});

const code = await readFile(outfile, 'utf8');

const header = [
  '// Generated from src/client.js by scripts/build-client.mjs. Do not edit.',
  'window.__ModuleLoader__.load({',
  `  id: ${JSON.stringify(packageId)},`,
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
].join('\n');

const footer = [
  '',
  '    return module.exports;',
  '  },',
  '});',
].join('\n');

await writeFile(resolve(root, 'client.js'), `${header}\n${code.trimEnd()}\n${footer}\n`, 'utf8');

console.log(`built client.js (${packageId})`);
