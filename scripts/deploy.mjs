/**
 * scripts/deploy.mjs — Apocrypha Deploy Script
 *
 * Local:  Injects built code into MongoDB (Isaac's user code entry).
 *         The engine picks it up on the next tick via timestamp detection.
 * Live:   Posts to Screeps API with SCREEPS_TOKEN.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const MODULES_DIR = resolve(ROOT, 'dist/modules');

const isLive = process.argv.includes('--live');
const isLocal = process.argv.includes('--local') || !isLive;

if (!isLocal && !isLive) {
  console.error('[deploy] Use --local or --live');
  process.exit(1);
}

/** Read all .js module files from dist/modules/ */
function readModules() {
  const modules = {};
  if (!existsSync(MODULES_DIR)) throw new Error('dist/modules/ not found — run build first');
  for (const file of readdirSync(MODULES_DIR)) {
    if (file.endsWith('.js')) {
      const name = file.replace('.js', '');
      modules[name] = readFileSync(resolve(MODULES_DIR, file), 'utf-8');
    }
  }
  return modules;
}

async function deployLocal() {
  const isaacId = '6a174d5e359b46002e1d39a0';
  const modules = readModules();
  const moduleList = Object.keys(modules);

  if (!modules.main) throw new Error('main module missing from build');

  // Build the MongoDB update with all modules
  const escaped = JSON.stringify(modules);
  const script = `
    var modules = ${escaped};
    db['users.code'].updateOne(
      {user: '${isaacId}'},
      {$set: {modules: modules, timestamp: new Date().getTime(), activeWorld: true, activeSim: true}},
      {upsert: true}
    );
    var c = db['users.code'].findOne({user: '${isaacId}'});
    print(c && c.modules ? Object.keys(c.modules).join(',') : 'MISSING');
  `;

  const tmpFile = resolve(tmpdir(), `apocrypha-deploy-${Date.now()}.js`);
  writeFileSync(tmpFile, script, 'utf-8');

  try {
    const result = execSync(
      `docker exec -i apocrypha-mongo mongosh --quiet screeps < "${tmpFile}"`,
      { encoding: 'utf-8', timeout: 15000, shell: true }
    ).trim();
    console.log(`[deploy] ✓ ${moduleList.length} modules → ${result}`);
  } finally {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  }
}

async function deployLive() {
  const token = process.env.SCREEPS_TOKEN;
  if (!token) {
    console.error('[deploy] SCREEPS_TOKEN not set.');
    process.exit(1);
  }

  const modules = readModules();
  if (!modules.main) throw new Error('main module missing from build');

  const resp = await fetch('https://screeps.com/api/user/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Token': token
    },
    body: JSON.stringify({ branch: 'default', modules })
  });

  if (resp.ok) {
    console.log(`[deploy] ✓ Live deploy (shard2) — ${Object.keys(modules).length} modules`);
  } else {
    console.error('[deploy] ✗ Failed:', resp.status, await resp.text());
  }
}

(async () => {
  if (isLocal) await deployLocal();
  if (isLive) await deployLive();
})();
