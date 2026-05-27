/**
 * build.mjs — Apocrypha Build Pipeline
 *
 * Bundles TypeScript sources into the Screeps-compatible format.
 * Output: dist/main.js (single-file bundle, exports `loop`)
 */

import * as esbuild from 'esbuild';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const ROOT = dirname(new URL(import.meta.url).pathname);
const SRC = resolve(ROOT, 'packages/bot/src/main.ts');
const OUT = resolve(ROOT, 'dist');
const WATCH = process.argv.includes('--watch');

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/** Shared esbuild config */
const config = {
  entryPoints: [SRC],
  bundle: true,
  outfile: resolve(OUT, 'main.js'),
  format: 'cjs',        // Screeps uses CommonJS require()
  platform: 'node',
  target: 'node18',
  external: [],          // Bundle everything
  minify: false,         // Keep readable for debugging
  sourcemap: false,      // Keep output small
  banner: {
    js: '/* Apocrypha — built ' + new Date().toISOString() + ' */'
  },
  logLevel: 'info',
  // Inject Screeps globals so esbuild doesn't complain
  define: {
    'OK': '0',
    'ERR_NOT_OWNER': '-1',
    'ERR_NO_PATH': '-2',
    'ERR_NAME_EXISTS': '-3',
    'ERR_BUSY': '-4',
    'ERR_NOT_FOUND': '-5',
    'ERR_NOT_ENOUGH_ENERGY': '-6',
    'ERR_NOT_ENOUGH_RESOURCES': '-6',
    'ERR_INVALID_TARGET': '-7',
    'ERR_FULL': '-8',
    'ERR_NOT_IN_RANGE': '-9',
    'ERR_INVALID_ARGS': '-10',
    'ERR_TIRED': '-11',
    'ERR_NO_BODYPART': '-12',
    'ERR_NOT_ENOUGH_EXTENSIONS': '-6',
    'ERR_RCL_NOT_ENOUGH': '-14',
    'ERR_GCL_NOT_ENOUGH': '-15',
  }
};

async function main() {
  if (WATCH) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('[build] Watching for changes...');
  } else {
    const start = Date.now();
    await esbuild.build(config);
    const size = readFileSync(resolve(OUT, 'main.js')).length;
    console.log(`[build] ✓ dist/main.js (${(size / 1024).toFixed(1)}KB) in ${Date.now() - start}ms`);
  }
}

main().catch(e => {
  console.error('[build] Failed:', e);
  process.exit(1);
});
