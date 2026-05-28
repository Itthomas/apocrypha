/**
 * scripts/monitor.mjs — Apocrypha Colony Monitor
 *
 * Reads Memory.stats from Redis, diffs against last check, prints health report.
 * Run standalone or via cron heartbeat.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const STATE_FILE = resolve(ROOT, '.screeps/agent-state.json');
const USER_ID = (() => {
  try {
    const result = execSync(
      'docker exec apocrypha-mongo mongosh --quiet screeps --eval "var u = db.users.findOne({username:\\"MaximumEdgeLord\\"}); print(u ? u._id.toString() : \\"MISSING\\");"',
      { encoding: 'utf-8', timeout: 5000, shell: true }
    ).trim();
    const id = result.split('\n').pop().trim();
    if (!id || id === 'MISSING') throw new Error('not found');
    return id;
  } catch (e) {
    console.error('[monitor] Cannot find user — falling back to hardcoded ID');
    return '6a17aa5d3ffd6c003118021b'; // fallback
  }
})();

// --- Helpers ---

function redisGet(key) {
  const raw = execSync(`docker exec apocrypha-redis redis-cli GET "${key}"`, {
    encoding: 'utf-8', timeout: 5000
  }).trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function loadState() {
  if (!existsSync(STATE_FILE)) return { checks: [], lastTick: 0 };
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Analysis ---

function analyze(stats, prev) {
  const issues = [];
  const notes = [];

  for (const [name, room] of Object.entries(stats.rooms || {})) {
    const prevRoom = prev?.rooms?.[name];
    const e = room.energy;
    const c = room.creeps;

    // Creep population
    if (c.total === 0) {
      issues.push(`🚨 ${name}: NO CREEPS — colony may be dead`);
    } else if (prevRoom && prevRoom.creeps.total > 0) {
      const delta = c.total - prevRoom.creeps.total;
      if (delta < -2) issues.push(`⚠️ ${name}: creep count dropped ${delta} (${prevRoom.creeps.total}→${c.total})`);
      else if (delta > 0) notes.push(`📈 ${name}: +${delta} creeps (${prevRoom.creeps.total}→${c.total})`);
    }

    // Energy economy
    if (e.harvested === 0 && c.total > 0) {
      issues.push(`⚠️ ${name}: zero energy harvested in stats window — harvesters may be stuck`);
    }
    if (e.available === e.capacity && room.rcl < 8) {
      notes.push(`💡 ${name}: energy full — consider more upgraders or builders`);
    }

    // Controller progress
    if (room.controller.etaTicks !== null) {
      if (prevRoom?.controller?.etaTicks) {
        const speedup = prevRoom.controller.etaTicks - room.controller.etaTicks;
        if (speedup > 1000) notes.push(`⚡ ${name}: controller progress accelerating (ETA ${room.controller.etaTicks}t)`);
      }
    }
    if (room.rcl > (prevRoom?.rcl || 0)) {
      notes.push(`🎉 ${name}: UPGRADED TO RCL ${room.rcl}!`);
    }

    // Role balance
    const byRole = c.byRole || {};
    const harvesters = byRole.harvester || 0;
    const builders = byRole.builder || 0;
    const upgraders = byRole.upgrader || 0;

    if (harvesters === 0 && c.total > 0) {
      issues.push(`🚨 ${name}: no harvesters — energy income will stop`);
    }
    if (room.constructionSites > 0 && builders === 0) {
      notes.push(`💡 ${name}: ${room.constructionSites} construction sites, no builders`);
    }
    if (room.rcl < 8 && upgraders === 0 && c.total > 2) {
      notes.push(`💡 ${name}: consider adding an upgrader (RCL ${room.rcl})`);
    }
  }

  // CPU
  if (stats.cpu) {
    if (stats.cpu.bucket < 2000) issues.push(`⚠️ CPU bucket low: ${stats.cpu.bucket}`);
    if (stats.cpu.used > stats.cpu.limit * 0.8) issues.push(`⚠️ CPU usage high: ${stats.cpu.used.toFixed(1)}/${stats.cpu.limit}`);
  }

  return { issues, notes };
}

// --- Main ---

function main() {
  const memory = redisGet(`memory:${USER_ID}`);
  if (!memory) {
    console.log('[monitor] ⚠️ No memory data — colony may be inactive');
    return 1;
  }

  const stats = memory.stats || memory;
  const prev = loadState();

  console.log(`=== Apocrypha Colony Health — tick ${stats.tick} ===\n`);

  // Header
  console.log(`CPU: bucket=${stats.cpu?.bucket || '?'}/${stats.cpu?.limit || '?'} used=${(stats.cpu?.used || 0).toFixed(1)}`);
  console.log(`GCL: L${stats.gcl?.level || 0} progress=${stats.gcl?.progress || 0}/${stats.gcl?.progressTotal || 0}`);

  // Room details
  for (const [name, room] of Object.entries(stats.rooms || {})) {
    const prevRoom = prev.lastStats?.rooms?.[name];
    const creepDelta = prevRoom ? room.creeps.total - prevRoom.creeps.total : 'new';
    console.log(`\n${name}: RCL${room.rcl} | energy ${room.energy.available}/${room.energy.capacity} | creeps ${room.creeps.total} (${creepDelta >= 0 ? '+' : ''}${creepDelta}) | controller ${room.controller.progress}/${room.controller.progressTotal}`);
  }

  // Analysis
  const { issues, notes } = analyze(stats, prev.lastStats);

  if (notes.length) {
    console.log(`\n--- Notes ---`);
    notes.forEach(n => console.log(n));
  }
  if (issues.length) {
    console.log(`\n--- Issues ---`);
    issues.forEach(i => console.log(i));
  }
  if (!issues.length && !notes.length) {
    console.log(`\n✅ Colony healthy — no changes needed`);
  }

  // Save state
  const state = {
    checks: [...(prev.checks || []).slice(-20), { tick: stats.tick, time: Date.now(), issues: issues.length, notes: notes.length }],
    lastTick: stats.tick,
    lastStats: stats
  };
  saveState(state);

  return issues.length;
}

process.exit(main());
