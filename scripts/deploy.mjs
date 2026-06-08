/**
 * scripts/deploy.mjs — Apocrypha Deploy Script
 *
 * Local:  Injects built code into MongoDB (Isaac's user code entry).
 *         The engine picks it up on the next tick via timestamp detection.
 * Live:   Posts to Screeps API with SCREEPS_TOKEN.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const MODULES_DIR = resolve(ROOT, 'dist/modules');

const isLive = process.argv.includes('--live');
const isLocal = process.argv.includes('--local') || !isLive;

// Parse --branch <name> for live deploys (defaults to 'default')
const branchIdx = process.argv.indexOf('--branch');
const branch = branchIdx !== -1 && branchIdx + 1 < process.argv.length
  ? process.argv[branchIdx + 1]
  : 'default';

if (!isLocal && !isLive) {
  console.error('[deploy] Use --local or --live');
  process.exit(1);
}

function mongoEval(expr) {
  return execSync(
    `docker exec apocrypha-mongo mongosh --quiet screeps --eval ${JSON.stringify(expr)}`,
    { encoding: 'utf-8', timeout: 5000 }
  ).trim();
}

/** Auto-detect Isaac's user ID from MongoDB */
function getUserId() {
  const result = mongoEval("var u = db.users.findOne({username:'MaximumEdgeLord'}); print(u ? u._id.toString() : 'MISSING');");
  const id = result.split('\n').pop().trim();
  if (!id || id === 'MISSING') throw new Error('User MaximumEdgeLord not found in MongoDB');
  return id;
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
  const isaacId = getUserId();
  console.log(`[deploy] User: MaximumEdgeLord (${isaacId})`);
  const modules = readModules();
  const moduleList = Object.keys(modules);

  if (!modules.main) throw new Error('main module missing from build');

  // Build the MongoDB update with all modules.
  // Screeps private server stores code under user[user.branch] (e.g. user["default"]).
  // We write to both the branch schema AND the top level for compatibility.
  const escaped = JSON.stringify(modules);
  const ts = Date.now();
  const script = `
    var modules = ${escaped};
    db['users.code'].updateOne(
      {user: '${isaacId}'},
      {$set: {
        modules: modules,
        branch: 'default',
        activeWorld: true,
        activeSim: true,
        timestamp: ${ts}
      }},
      {upsert: true}
    );
    // Also write to the branch subdocument that the engine actually reads
    db['users.code'].updateOne(
      {user: '${isaacId}'},
      {$set: {default: {modules: modules, timestamp: ${ts}}}},
      {upsert: true}
    );
    var c = db['users.code'].findOne({user: '${isaacId}'});
    var modList = [];
    if (c.default && c.default.modules) modList = Object.keys(c.default.modules);
    else if (c.modules) modList = Object.keys(c.modules);
    print(modList.join(','));
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

  // Also sync modules to bot directory (bot users load from filesystem, not MongoDB)
  try {
    const botDir = resolve(ROOT, '.screeps/node_modules/screeps/bots/apocrypha');
    mkdirSync(botDir, { recursive: true });
    for (const [name, code] of Object.entries(modules)) {
      if (name === 'main') {
        writeFileSync(resolve(botDir, 'main.js'), code);
      }
      writeFileSync(resolve(botDir, name + '.js'), code);
    }
    // Reload bot via CLI
    execSync('tmux kill-session -t rel 2>/dev/null; sleep 1; tmux new-session -d -s rel "cd ' + ROOT + ' && docker compose exec screeps screeps-launcher cli"; sleep 3; echo "bots.reload(\\"apocrypha\\")" | tmux load-buffer -; tmux paste-buffer -t rel; tmux send-keys -t rel Enter', { timeout: 10000, shell: true });
    console.log('[deploy] ✓ Bot dir synced + reloaded');
  } catch (e) {
    console.log('[deploy] ⚠ Bot dir sync failed — run manually: cp dist/modules/*.js .screeps/node_modules/screeps/bots/apocrypha/');
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
    body: JSON.stringify({ branch, modules })
  });

  if (resp.ok) {
    console.log(`[deploy] ✓ Live deploy (${branch}) — ${Object.keys(modules).length} modules`);
  } else {
    console.error('[deploy] ✗ Failed:', resp.status, await resp.text());
  }
}

(async () => {
  if (isLocal) await deployLocal();
  if (isLive) await deployLive();
})();
