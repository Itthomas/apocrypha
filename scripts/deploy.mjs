/**
 * scripts/deploy.mjs — Apocrypha Deploy Script (rewritten)
 *
 * Local mode: copies to bot dir + reloads via CLI
 * Live mode:  Posts to Screeps API with SCREEPS_TOKEN
 */

import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const DIST = resolve(ROOT, 'dist/main.js');

const isLive = process.argv.includes('--live');
const isLocal = process.argv.includes('--local') || !isLive;

if (!existsSync(DIST)) {
  console.error('[deploy] dist/main.js not found. Run `npm run build` first.');
  process.exit(1);
}

async function deployLocal() {
  // Copy to local screeps bot directory
  const botDir = resolve(ROOT, '.screeps/node_modules/screeps/bots/apocrypha');
  mkdirSync(botDir, { recursive: true });
  copyFileSync(DIST, resolve(botDir, 'main.js'));
  console.log('[deploy] ✓ Copied to', botDir);

  // Reload bot via CLI (needs a running tmux CLI session)
  // Start CLI if not running: tmux new-session -d -s screeps-cli 'cd apocrypha && docker compose exec screeps screeps-launcher cli'
  try {
    execSync('tmux send-keys -t screeps-cli -l "bots.reload(\\"apocrypha\\")" && tmux send-keys -t screeps-cli Enter',
      { cwd: ROOT, timeout: 5000 });
    console.log('[deploy] ✓ Bot reloaded');
  } catch (e) {
    console.log('[deploy] ⚠ Reload failed — restart server or reload CLI manually');
  }
}

async function deployLive() {
  const token = process.env.SCREEPS_TOKEN;
  if (!token) {
    console.error('[deploy] SCREEPS_TOKEN not set.');
    process.exit(1);
  }

  const code = readFileSync(DIST, 'utf-8');
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
