import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

if (!existsSync('.env')) {
  console.error('Missing .env -- copy .env.example to .env and fill in the real values.');
  process.exit(1);
}
process.loadEnvFile('.env');

const required = ['API_BASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env.`);
    process.exit(1);
  }
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');

function hostPermissionOf(urlString) {
  const url = new URL(urlString);
  return `${url.protocol}//${url.hostname}/*`;
}

const manifestTemplate = readFileSync('manifest.template.json', 'utf8');
const manifest = manifestTemplate
  .replace('__API_HOST_PERMISSION__', hostPermissionOf(process.env.API_BASE_URL))
  .replace('__SUPABASE_HOST_PERMISSION__', hostPermissionOf(process.env.SUPABASE_URL));
JSON.parse(manifest);
writeFileSync('dist/manifest.json', manifest);

cpSync('popup.html', 'dist/popup.html');
cpSync('icons', 'dist/icons', { recursive: true });
console.log('dist/manifest.json, popup.html and icons/ ready.');

const define = Object.fromEntries(
  required.map((key) => [`process.env.${key}`, JSON.stringify(process.env[key])]),
);
define['process.env.DEBUG'] = JSON.stringify(process.env.DEBUG ?? 'false');

const entryFiles = ['background', 'content', 'main-world-hook', 'popup'];

const options = {
  entryPoints: entryFiles.map((name) => `src/${name}.ts`),
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  sourcemap: watch,
  logLevel: 'info',
  define,
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('esbuild: watching...');
} else {
  await esbuild.build(options);
  console.log('esbuild: build done.');
}

console.log(
  watch
    ? 'Load dist/ in chrome://extensions as "unpacked" -- it will keep updating on its own.'
    : 'dist/ is ready to load in chrome://extensions ("unpacked") or zip as-is.',
);
