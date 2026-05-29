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
  if (rcl >= 3 && rcl <= 4) {
    return [
      { role: 'miner',    minimum: 1, maximum: 2 },
      { role: 'survivor', minimum: 3, maximum: 6 },
    ];
  }

  // RCL 5+: specialized roles, survivors as backup
  const quotas: SpawnQuota[] = [
    { role: 'miner',    minimum: 1, maximum: 2 },
    { role: 'hauler',   minimum: 2, maximum: 4 },
    { role: 'survivor', minimum: 0, maximum: 2 },
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

  // Check spawn has an overflow container within 3 tiles
  const overflow = spawns[0].pos.findInRange(FIND_STRUCTURES, 3, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  });
  if (overflow.length === 0) return false;

  return true;
}

/** Smart survivor spawn gate for RCL 3+ */
function survivorGateRcl3(room: Room): boolean {
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
  // If required containers aren't built, only survivors may spawn
  if (role !== 'survivor' && !containersBuilt(room)) return false;

  switch (role) {
    case 'survivor': return survivorGateRcl3(room);
    case 'builder':  return builderGate(room);
    case 'upgrader': return upgraderGate(room);
    case 'hauler': {
      const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      });
      return containers.length > 0;
    }
    default: return true; // miner always allowed once containers exist
  }
}

/** Run spawn logic for one room. Call once per tick. */
export function runSpawnManager(room: Room): void {
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

  // Try each role in priority order
  for (const quota of quotas) {
    const current = creepCounts[quota.role] || 0;

    // Skip if at max
    if (current >= quota.maximum) continue;

    // RCL 3-4: if we need more miners and a miner body is affordable,
    // skip survivors entirely — the second miner is critical for supply
    if (rcl >= 3 && rcl <= 4 && quota.role === 'survivor') {
      const minerQuota = quotas.find(q => q.role === 'miner');
      const minerCount = creepCounts['miner'] || 0;
      if (minerQuota && minerCount < minerQuota.maximum) {
        const minerBody = getBody('miner', rcl, room.energyAvailable);
        if (minerBody && minerBody.length > 0) continue;
      }
    }

    // At RCL 1-2, survivors skip gate check (always allowed)
    // At RCL 3+, gate applies when at or above minimum
    if (rcl >= 3 && current >= quota.minimum) {
      if (!spawnGate(quota.role, room)) continue;
    }

    // Get body for this role
    const body = getBody(quota.role, rcl, room.energyAvailable);
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
