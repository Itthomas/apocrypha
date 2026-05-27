/**
 * scripts/deploy.mjs — Apocrypha Deploy Script
 *
 * Local:  Injects built code into MongoDB (Isaac's user code entry).
 *         The engine picks it up on the next tick via timestamp detection.
 * Live:   Posts to Screeps API with SCREEPS_TOKEN.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const DIST = resolve(ROOT, 'dist/main.js');

const isLive = process.argv.includes('--live');
const isLocal = process.argv.includes('--local') || !isLive;

if (!isLocal && !isLive) {
  console.error('[deploy] Use --local or --live');
  process.exit(1);
}

const code = readFileSync(DIST, 'utf-8');

async function deployLocal() {
  const isaacId = '6a174d5e359b46002e1d39a0';

  // Write mongosh script to a temp file (avoids shell escaping hell)
  const escaped = JSON.stringify(code);
  const script = `
    db['users.code'].updateOne(
      {user: '${isaacId}'},
      {$set: {modules: {main: ${escaped}}, timestamp: new Date().getTime(), activeWorld: true, activeSim: true}},
      {upsert: true}
    );
    var c = db['users.code'].findOne({user: '${isaacId}'});
    print(c && c.modules && c.modules.main ? c.modules.main.length + ' chars' : 'MISSING');
  `;

  const tmpFile = resolve(tmpdir(), `apocrypha-deploy-${Date.now()}.js`);
  writeFileSync(tmpFile, script, 'utf-8');

  try {
    const result = execSync(
      `docker exec -i apocrypha-mongo mongosh --quiet screeps < "${tmpFile}"`,
      { encoding: 'utf-8', timeout: 15000, shell: true }
    ).trim();
    console.log(`[deploy] ✓ MongoDB updated (${(code.length / 1024).toFixed(1)}KB) → ${result}`);
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

  const resp = await fetch('https://screeps.com/api/user/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Token': token
    },
    body: JSON.stringify({ branch: 'default', modules: { main: code } })
  });

  if (resp.ok) {
    console.log('[deploy] ✓ Live deploy (shard2)');
  } else {
    console.error('[deploy] ✗ Failed:', resp.status, await resp.text());
  }
}

(async () => {
  if (isLocal) await deployLocal();
  if (isLive) await deployLive();
})();
