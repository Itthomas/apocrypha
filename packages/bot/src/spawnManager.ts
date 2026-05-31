/**
 * spawnManager.ts — Apocrypha Spawn Manager
 *
 * Uses bodyDesigner for per-role body comps based on RCL and energy.
 * Manages spawn queues with quota limits and spawn gates.
 *
 * RCL 1-2: Survivors only (max 4). Generalists that do everything.
 * RCL 3+: Specialized roles appear. Survivors drop to max 2, with smart
 *   spawn criteria — only spawn when energy economy is genuinely faltering,
 *   not when a miner simply ages out and is being replaced.
 *
 * Spawn gates:
 * - survivor (RCL 3+): only when energy economy is threatened (not just miner death)
 * - builder: only if overflow container ≥50% full AND construction sites exist, max 2
 * - upgrader: only if controller container is full, max 1
 * - miner: max 2 (one per source)
 * - hauler: max 3 at RCL 3+, only if source containers exist
 */

import { getBody } from './bodyDesigner';
import { trackSpawnSpend } from './telemetry';

interface SpawnQuota {
  role: string;
  minimum: number;
  maximum: number;
}

/**
 * Get spawn quotas for a room based on RCL.
 */
function getQuotas(rcl: number): SpawnQuota[] {
  // RCL 1-2: survivors only
  if (rcl <= 2) {
    return [
      { role: 'survivor', minimum: 2, maximum: 4 },
    ];
  }

  // RCL 3-4: miner + survivors. Survivors handle all transport,
  // building, and upgrading — pulling from miner containers.
  // Miner max is source-based (computed dynamically in the spawn loop).
  if (rcl >= 3 && rcl <= 4) {
    return [
      { role: 'miner',    minimum: 0, maximum: 0 },
      { role: 'survivor', minimum: 3, maximum: 8 },
    ];
  }

  // RCL 5+: specialized roles, survivors as backup.
  // Miner and hauler max are source-based.
  const quotas: SpawnQuota[] = [
    { role: 'miner',    minimum: 0, maximum: 0 },
    { role: 'hauler',   minimum: 0, maximum: 0 },
    { role: 'survivor', minimum: 0, maximum: 8 },
    { role: 'builder',  minimum: 0, maximum: 2 },
    { role: 'upgrader', minimum: 0, maximum: 2 },
  ];

  return quotas;
}

/** Check if required containers are built (source containers + spawn overflow) */
function containersBuilt(room: Room): boolean {
  const sources = room.find(FIND_SOURCES);
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return false;

  // Check each source has an adjacent container
  for (const source of sources) {
    const nearby = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    if (nearby.length === 0) return false;
  }

  return true;
}

// ── Economy Tracker (container energy moving average) ──

interface EconomyMemory {
  /** Rolling samples of total source container energy (max 5) */
  samples: number[];
  /** Soft cap for survivors, floats between hard min and max */
  softCap: number;
  /** Tick of last cap adjustment */
  lastAdjustment: number;
  /** Next tick to collect a sample */
  nextSample: number;
}

const ECO_SAMPLE_INTERVAL = 30;
const ECO_MAX_SAMPLES = 5;
const ECO_ADJUST_COOLDOWN = 300;

function runEconomyTracker(room: Room): void {
  if (!Memory.economy) {
    Memory.economy = { samples: [], softCap: 8, lastAdjustment: 0, nextSample: Game.time };
  }
  const econ = Memory.economy as EconomyMemory;

  // Sample total energy in source containers every ECO_SAMPLE_INTERVAL ticks
  if (Game.time >= econ.nextSample) {
    econ.nextSample = Game.time + ECO_SAMPLE_INTERVAL;

    let energy = 0, capacity = 0;
    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      });
      for (const c of containers) {
        energy += c.store.getUsedCapacity(RESOURCE_ENERGY);
        capacity += c.store.getCapacity(RESOURCE_ENERGY);
      }
    }

    econ.samples.push(capacity > 0 ? energy / capacity : 0);
    if (econ.samples.length > ECO_MAX_SAMPLES) econ.samples.shift();
  }

  // Need 3+ samples and cooldown clear before adjusting
  if (econ.samples.length < 3) return;
  if (Game.time - econ.lastAdjustment < ECO_ADJUST_COOLDOWN) return;

  // Count consecutive rises / declines
  let rises = 0, falls = 0;
  for (let i = 1; i < econ.samples.length; i++) {
    if (econ.samples[i] < econ.samples[i - 1]) { falls++; rises = 0; }
    else if (econ.samples[i] > econ.samples[i - 1]) { rises++; falls = 0; }
    else { rises = 0; falls = 0; }
  }

  const fill = econ.samples[econ.samples.length - 1];
  const allHealthy = econ.samples.every(s => s > 0.6);

  const HARD_MIN = 3, HARD_MAX = 8;
  if (falls >= 3 && fill < 0.3 && econ.softCap > HARD_MIN) {
    econ.softCap--;
    econ.lastAdjustment = Game.time;
    console.log(`[economy] ↓ softCap=${econ.softCap} (energy declining, fill=${(fill*100).toFixed(0)}%)`);
  } else if ((rises >= 5 && fill > 0.6 || allHealthy) && econ.softCap < HARD_MAX) {
    econ.softCap++;
    econ.lastAdjustment = Game.time;
    console.log(`[economy] ↑ softCap=${econ.softCap} (energy rising, fill=${(fill*100).toFixed(0)}%)`);
  }
}
function survivorGateRcl3(room: Room): boolean {
  // Soft cap from economy tracker — don't spawn beyond what the
  // container buffer can sustain
  const econ = Memory.economy as EconomyMemory | undefined;
  const survivorCount = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'survivor').length;
  if (econ && survivorCount >= econ.softCap) return false;

  const miners = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'miner');

  // If required containers aren't built yet, survivors stay active to build them
  if (!containersBuilt(room)) return true;

  // If 0 miners at all, definitely spawn survivor
  if (miners.length === 0) return true;

  // If we have at least 1 miner, check if the energy economy is actually struggling
  // Don't spawn survivors just because a miner aged out — wait for the replacement

  // Check if spawn is about to produce a miner (it's spawning or has energy)
  const spawns = room.find(FIND_MY_SPAWNS);
  const spawningMiner = spawns.some(s => {
    if (!s.spawning) return false;
    const spawningCreep = Game.creeps[s.spawning.name];
    return spawningCreep && spawningCreep.memory.role === 'miner';
  });

  // If a miner is currently spawning, no survivor needed
  if (spawningMiner) return false;

  // Check energy economy: is spawn energy critically low AND not recovering?
  const energyCap = room.energyCapacityAvailable;
  const energyAvail = room.energyAvailable;
  const energyRatio = energyAvail / energyCap;

  // If energy is above 30% of capacity, system is healthy — no survivor needed
  if (energyRatio > 0.3) {
    // Even if energy ratio looks healthy, check if we can actually afford a miner.
    // 300/750 = 40% looks fine on paper, but the cheapest miner is 500e — so
    // without this check the colony starves while the gate says "we're healthy."
    const rcl = room.controller?.level ?? 0;
    const minerBody = getBody('miner', rcl, energyAvail);
    if (!minerBody || minerBody.length === 0) return true;
    return false;
  }

  // Check telemetry: has energy been flowing recently?
  const stats = Memory.stats;
  if (stats) {
    const roomStats = stats.rooms?.[room.name];
    if (roomStats) {
      // If energy was harvested in the last stats window, system is working
      if (roomStats.energy.harvested > 0) return false;
    }
  }

  // Energy is low AND no recent harvests — economy is faltering
  return energyAvail < 100; // Critical threshold
}

/**
 * RCL 5+ survivor gate: spawn limits based on storage energy instead of
 * the economy soft-cap.  Survivors are the generalist workforce at all
 * RCLs now — storage level determines how many we can sustain.
 *
 *   storage < 100k   → max 3
 *   storage 100-200k  → max 5
 *   storage > 200k    → max 8
 */
function survivorGateRcl5(room: Room): boolean {
  const survivorCount = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'survivor').length;

  // Storage-based cap
  const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  let maxSurvivors = 1;
  if (storageEnergy >= 200_000) maxSurvivors = 8;
  else if (storageEnergy >= 100_000) maxSurvivors = 5;
  else if (storageEnergy >= 50_000) maxSurvivors = 3;

  if (survivorCount >= maxSurvivors) return false;

  // Safety checks (same as RCL 3-4)
  if (!containersBuilt(room)) return true;
  const miners = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'miner');
  if (miners.length === 0) return true;

  return true;
}

/** Build gate: overflow container must be ≥50% full */
function builderGate(room: Room): boolean {
  const sites = room.find(FIND_CONSTRUCTION_SITES);
  if (sites.length === 0) return false;

  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return false;

  const container = spawns[0].pos.findInRange(FIND_STRUCTURES, 3, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  })[0];
  if (!container) {
    // Allow builders at RCL 1-2 even without overflow container
    return (room.controller?.level ?? 0) <= 2;
  }

  const store = (container as StructureContainer).store;
  return store.getUsedCapacity(RESOURCE_ENERGY) >= store.getCapacity(RESOURCE_ENERGY) * 0.5;
}

/** Upgrader gate: controller container must exist and be full */
function upgraderGate(room: Room): boolean {
  const controller = room.controller;
  if (!controller) return false;
  const container = controller.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  })[0];
  if (!container) return false;
  return (container as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) === 0;
}

/** Dispatch to the correct gate function */
function spawnGate(role: string, room: Room): boolean {
  // If required containers aren't built, only miners and survivors may spawn.
  // Miners can direct-harvest until containers are ready; survivors are generalists.
  if (role !== 'survivor' && role !== 'miner' && !containersBuilt(room)) return false;

  switch (role) {
    case 'survivor': {
      const rcl = room.controller?.level ?? 0;
      return rcl >= 5 ? survivorGateRcl5(room) : survivorGateRcl3(room);
    }
    case 'builder':  return builderGate(room);
    case 'upgrader': return upgraderGate(room);
    case 'hauler': {
      const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      });
      return containers.length > 0;
    }
    default: return true; // miner always allowed
  }
}

// ── Colonization scout spawning ──

const SCOUT_BEARINGS = [0, 1, 2, 3, 4, 5, 6, 7];
const SCOUT_MAX_RESPAWNS = 5;

function trySpawnScout(room: Room, spawn: StructureSpawn): boolean {
  const col = Memory.colonization;
  if (!col?.active || Game.time >= col.deadline) return false;
  if ((room.controller?.level ?? 0) < 5) return false;

  for (const bearing of SCOUT_BEARINGS) {
    const key = `${room.name}_${bearing}`;
    const state = col.scoutState[key];
    const respawns = state?.respawns ?? 0;

    // Already alive? Check Game.creeps globally — scout may be in neighbor room
    const name = state?.name;
    if (name && Game.creeps[name]) continue;

    // Respawning: must be within budget
    if (respawns >= SCOUT_MAX_RESPAWNS) continue;

    const scoutName = `scout_${room.name}_${bearing}_${Game.time}`;
    const result = spawn.spawnCreep([MOVE], scoutName, {
      memory: {
        role: 'scout',
        bearing,
        temperature: 0.1 * respawns,
        prevRoom: '',
        chosenExit: 0,
        lastRoom: '',
        trail: [],
        respawns: respawns + 1,
        sourceRoom: room.name,
      }
    });

    if (result === OK) {
      col.scoutState[key] = { bearing, respawns: respawns + 1, name: scoutName };
      return true;
    }
  }

  return false;
}

// ── Spawn Manager ──

/** Run spawn logic for one room. Call once per tick. */
export function runSpawnManager(room: Room): void {
  // Update economy tracker (container energy moving average + soft cap)
  runEconomyTracker(room);

  const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
  if (spawns.length === 0) return;

  const rcl = room.controller?.level ?? 0;
  const quotas = getQuotas(rcl);

  // Count current creeps by role
  const creepCounts: Record<string, number> = {};
  for (const c of room.find(FIND_MY_CREEPS)) {
    const role = c.memory.role ?? 'unknown';
    creepCounts[role] = (creepCounts[role] || 0) + 1;
  }

  // ── Colonization scouts (spawn before regular roles) ──
  if (trySpawnScout(room, spawns[0])) return;

  // Try each role in priority order
  const sourceCount = room.find(FIND_SOURCES).length;
  for (const quota of quotas) {
    const current = creepCounts[quota.role] || 0;

    // Miner and hauler max is one per source in the room
    const effectiveMax = (quota.role === 'miner' || quota.role === 'hauler')
      ? sourceCount
      : quota.maximum;

    // Skip if at max
    if (current >= effectiveMax) continue;

    // At RCL 1-2, survivors skip gate check (always allowed)
    // At RCL 3+, gate applies when at or above minimum.
    // Miner/hauler have minimum 0 so the gate always applies at RCL 3+.
    if (rcl >= 3 && current >= quota.minimum) {
      if (!spawnGate(quota.role, room)) continue;
    }

    // ── Spawn cooldown: wait if full-capacity body is better than what's available now ──
    if (!Memory.spawnCooldowns) Memory.spawnCooldowns = {};
    const cooldown = Memory.spawnCooldowns;
    const role = quota.role;

    // Cooldown active → skip this role
    if (cooldown[role] && Game.time < cooldown[role]) continue;

    // Get body with current energy
    const body = getBody(role, rcl, room.energyAvailable);

    // Cooldown just expired → force-spawn with whatever we have
    if (cooldown[role] && Game.time >= cooldown[role]) {
      delete cooldown[role];
      if (!body || body.length === 0) continue; // still nothing affordable — skip
    } else {
      // No cooldown active — check if we should wait for a better body
      const bestBody = getBody(role, rcl, room.energyCapacityAvailable);
      if (bestBody && body) {
        const bestCost = bestBody.reduce((sum, p) => sum + BODYPART_COST[p], 0);
        const curCost = body.reduce((sum, p) => sum + BODYPART_COST[p], 0);
        if (bestCost > curCost && room.energyAvailable < room.energyCapacityAvailable) {
          cooldown[role] = Game.time + 50;
          continue;
        }
      }
    }

    if (!body || body.length === 0) continue;

    const name = quota.role + '_' + Game.time;
    for (const spawn of spawns) {
      const result = spawn.spawnCreep(body, name, {
        memory: {
          role: quota.role,
          harvesting: true,
          building: false,
          upgrading: false,
          positioned: false,
          task: 2, // Task.HARVEST for survivors
          taskLockedUntil: 0,
        }
      });
      if (result === OK) {
        const cost = body.reduce((sum, p) => sum + BODYPART_COST[p], 0);
        trackSpawnSpend(room.name, cost);
        console.log('[spawn] ' + name + ' (' + quota.role + ') body=' + body.join(',') + ' cost=' + cost + 'e');
        return;
      }
    }
  }
}
