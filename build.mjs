/**
 * build.mjs — Apocrypha Build Pipeline
 *
 * Builds TypeScript sources into separate Screeps-compatible CommonJS modules.
 * Output: dist/modules/ — one .js file per module, loaded via require() at runtime.
 *
 * Cross-module imports (e.g. role.harvester → telemetry) are left as require() calls.
 */


import * as esbuild from 'esbuild';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';

const ROOT = dirname(new URL(import.meta.url).pathname);
const SRC = resolve(ROOT, 'packages/bot/src');
const OUT = resolve(ROOT, 'dist/modules');
const WATCH = process.argv.includes('--watch');

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// Each Screeps module. Inter-module imports (e.g. harvester → telemetry) are
// left as require() calls by marking all OTHER module paths as external.
const modules = {
  'main':                 'main.ts',
  'role.miner':           'roles/miner.ts',
  'role.hauler':          'roles/hauler.ts',
  'role.survivor':        'roles/survivor.ts',
  'role.claimer':         'roles/claimer.ts',
  'role.colonyBuilder':   'roles/colonyBuilder.ts',
  'role.attacker':        'roles/attacker.ts',
  'role.attrition':       'roles/attrition.ts',
  'role.defender':        'roles/defender.ts',
  'role.hitAndRunner':    'roles/hitAndRunner.ts',
  'role.ranger':          'roles/ranger.ts',
  'role.remoteScout':     'roles/remoteScout.ts',
  'role.reserver':        'roles/reserver.ts',
  'role.remoteWorker':    'roles/remoteWorker.ts',
  'spawnManager':         'spawnManager.ts',
  'bodyDesigner':         'bodyDesigner.ts',
  'constructionPlanner':  'constructionPlanner.ts',
  'telemetry':            'telemetry/index.ts',
  'mantra':               'mantra.ts',
  'blueprint':            'blueprint.ts',
  'tower':                'tower.ts',
  'colonization':         'colonization.ts',
  'role.scout':           'roles/scout.ts',
  'colonization.scoring': 'colonization/scoring.ts',
  'lib.travel':           'lib/travel.ts',
  'remoteHarvesting':     'remoteHarvesting.ts',
};

// All source entry paths (used to detect cross-module imports)
const allEntries = Object.values(modules).map(e => resolve(SRC, e));

// Shared esbuild config
const baseConfig = {
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  bundle: true,
  minify: false,
  sourcemap: false,
  logLevel: 'info',
  define: {
    'OK': '0', 'ERR_NOT_OWNER': '-1', 'ERR_NO_PATH': '-2',
    'ERR_NAME_EXISTS': '-3', 'ERR_BUSY': '-4', 'ERR_NOT_FOUND': '-5',
    'ERR_NOT_ENOUGH_ENERGY': '-6', 'ERR_NOT_ENOUGH_RESOURCES': '-6',
    'ERR_INVALID_TARGET': '-7', 'ERR_FULL': '-8', 'ERR_NOT_IN_RANGE': '-9',
    'ERR_INVALID_ARGS': '-10', 'ERR_TIRED': '-11', 'ERR_NO_BODYPART': '-12',
    'ERR_NOT_ENOUGH_EXTENSIONS': '-6', 'ERR_RCL_NOT_ENOUGH': '-14',
    'ERR_GCL_NOT_ENOUGH': '-15',
  }
};

/**
 * Esbuild plugin: force cross-module imports to use require() instead of bundling.
 * Only intercepts relative imports (starting with ".") that resolve to another module.
 * When role.builder.ts imports from '../telemetry', the output becomes require('telemetry').
 */
function screepsCrossModulePlugin(currentName) {
  return {
    name: 'screeps-cross-module',
    setup(build) {
      // Only intercept relative imports (./foo or ../bar)
      build.onResolve({ filter: /^\./ }, (args) => {
        // Resolve the import path relative to the importer
        const resolved = resolve(dirname(args.importer), args.path);

        // Guard: if the resolved import is within the CURRENT module's directory
        // tree, let esbuild bundle it normally — it's an intra-module import.
        const currentEntryAbs = resolve(SRC, modules[currentName]);
        const currentDir = dirname(currentEntryAbs);
        if (resolved.startsWith(currentDir + '/')) {
          return undefined; // intra-module, bundle internally
        }

        // Find all matching modules, pick the best match.
        // Exact file match wins over directory prefix match.
        // For directory matches, deepest directory wins.
        let bestMatch = null;
        let bestScore = 0; // bits: exact file match (1<<30) | directory depth
        for (const [modName, modEntry] of Object.entries(modules)) {
          if (modName === currentName) continue;
          const modEntryAbs = resolve(SRC, modEntry);
          const modDir = dirname(modEntryAbs);

          if (resolved === modEntryAbs || resolved + '.ts' === modEntryAbs) {
            // Exact file match — highest priority
            const score = (1 << 30) + modDir.length;
            if (score > bestScore) { bestScore = score; bestMatch = modName; }
          } else if (resolved === modDir || resolved.startsWith(modDir + '/')) {
            // Directory prefix match
            if (modDir.length > bestScore) { bestScore = modDir.length; bestMatch = modName; }
          }
        }

        if (bestMatch) {
          return { path: bestMatch, external: true };
        }

        return undefined; // not a cross-module import, let esbuild bundle normally
      });
    },
  };
}

async function buildModule(name, entry) {
  const entryAbs = resolve(SRC, entry);

  // Screeps module names that should be kept as require() calls (used by main.ts)
  const externalModules = Object.keys(modules).filter(m => m !== name);

  await esbuild.build({
    ...baseConfig,
    entryPoints: [entryAbs],
    outfile: resolve(OUT, name + '.js'),
    external: externalModules,
    plugins: [screepsCrossModulePlugin(name)],
  });
}

async function main() {
  const start = Date.now();
  let totalSize = 0;

  for (const [name, entry] of Object.entries(modules)) {
    await buildModule(name, entry);
    const size = readFileSync(resolve(OUT, name + '.js')).length;
    totalSize += size;
    console.log(`  ${name}.js (${(size / 1024).toFixed(1)}KB)`);
  }

  writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify({
    built: new Date().toISOString(),
    modules: Object.keys(modules)
  }, null, 2));

  console.log(`[build] ✓ ${Object.keys(modules).length} modules (${(totalSize / 1024).toFixed(1)}KB total) in ${Date.now() - start}ms`);
}

main().catch(e => {
  console.error('[build] Failed:', e);
  process.exit(1);
});
