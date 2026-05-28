/**
 * scripts/recover.mjs — Apocrypha Colony Recovery
 *
 * Checks if the colony is alive. If not, respawns and deploys.
 * Safe to run any time — does nothing if colony is healthy.
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const USERNAME = 'MaximumEdgeLord';
const ROOM = process.argv[2] || 'W7N4';

function mongoEval(expr) {
  return execSync(
    `docker exec apocrypha-mongo mongosh --quiet screeps --eval ${JSON.stringify(expr)}`,
    { encoding: 'utf-8', timeout: 5000 }
  ).trim();
}

function tmuxSend(cmd) {
  execSync(`echo '${cmd}' | tmux load-buffer - && tmux paste-buffer -t rec && tmux send-keys -t rec Enter`, { timeout: 5000 });
}

/** Check if the Screeps server is running */
function serverRunning() {
  try {
    execSync('docker ps --filter name=apocrypha-server --format "{{.Status}}"', { timeout: 3000 });
    return true;
  } catch { return false; }
}

/** Check if the colony has an active spawn */
function colonyAlive() {
  try {
    const result = mongoEval(`
      var user = db.users.findOne({username:'${USERNAME}'});
      if (!user) { print('NO_USER'); return; }
      if (!user.active) { print('INACTIVE'); return; }
      var spawn = db['rooms.objects'].findOne({user: user._id.toString(), type: 'spawn'});
      if (!spawn) { print('NO_SPAWN'); return; }
      print('ALIVE:' + spawn.room);
    `);
    return result.includes('ALIVE');
  } catch (e) {
    console.error('[recover] MongoDB query failed:', e.message);
    return false;
  }
}

/** Respawn the colony */
function respawn() {
  // Kill any existing CLI, start fresh
  execSync('tmux kill-session -t rec 2>/dev/null; sleep 1', { timeout: 3000 }).catch(() => {});

  // Start CLI
  execSync(
    `tmux new-session -d -s rec "cd ${ROOT} && docker compose exec screeps screeps-launcher cli"`,
    { timeout: 5000 }
  );
  execSync('sleep 3');

  // Reset and respawn
  console.log('[recover] Respawning colony...');
  tmuxSend('system.resetAllData()');
  execSync('sleep 2');
  tmuxSend(`bots.spawn("apocrypha","${ROOM}",{username:"${USERNAME}",cpu:100,gcl:1})`);
  execSync('sleep 3');

  // Set active to boolean true (bots.spawn sets it as timestamp)
  mongoEval(`db.users.updateOne({username:'${USERNAME}'},{$set:{active:true}})`);

  // Kill CLI
  execSync('tmux kill-session -t rec 2>/dev/null', { timeout: 2000 }).catch(() => {});
  console.log('[recover] ✓ Respawned in', ROOM);
}

/** Deploy latest code */
function deploy() {
  console.log('[recover] Building...');
  execSync(`cd ${ROOT} && node build.mjs`, { timeout: 15000, stdio: 'pipe' });
  console.log('[recover] Deploying...');
  execSync(`cd ${ROOT} && node scripts/deploy.mjs --local`, { timeout: 15000, stdio: 'pipe' });
  console.log('[recover] ✓ Deployed');
}

// --- Main ---
function main() {
  if (!serverRunning()) {
    console.error('[recover] ✗ Screeps server not running. Start with: docker compose up -d');
    process.exit(1);
  }

  if (colonyAlive()) {
    console.log('[recover] ✓ Colony alive — nothing to do');
    process.exit(0);
  }

  console.log('[recover] ⚠️ Colony down — recovering...');
  respawn();
  deploy();

  console.log('[recover] ✓ Recovery complete');
}

main();
